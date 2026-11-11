// NEAR wallet + RPC context. Follows the official near-examples frontend
// (NEAR Connect + near-api-js). NEAR Wallet Selector is deprecated per the docs.
//
// The function-call key plugin adds a limited key for this contract at sign-in,
// so feeding / poking / the faucet sign in the browser without a wallet popup.

import { createContext, PropsWithChildren, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { FailoverRpcProvider, JsonRpcProvider, getTransactionLastResult } from "near-api-js";
import { NearConnector, type EventMap } from "@hot-labs/near-connect";
import { createAccessKeyPlugin } from "function-call-key-plugin";
import { CONTRACT_ID, KEY_METHODS, NETWORK, RPC_URLS } from "./config";
import { Call, Guest, createGuest, guestCall, loadGuest } from "./guest";

const GUEST_ON = "totem.guest.active";
const guestActive = () => {
  try {
    return localStorage.getItem(GUEST_ON) === "1";
  } catch {
    return false;
  }
};
const setGuestActive = (on: boolean) => {
  try {
    if (on) localStorage.setItem(GUEST_ON, "1");
    else localStorage.removeItem(GUEST_ON);
  } catch {
    /* ignore */
  }
};

type Wallet = Awaited<ReturnType<NearConnector["wallet"]>>;

export interface NearCtx {
  ready: boolean;
  accountId: string;
  /** true when playing as a gasless guest (no wallet; the game pays the gas) */
  isGuest: boolean;
  signIn: () => Promise<void>;
  /** Start (or resume) a free guest account: no wallet, no NEAR needed. */
  playAsGuest: () => Promise<string>;
  /** Several calls in one go (one meta-transaction for guests, one wallet tx otherwise). */
  callMany: (calls: Call[]) => Promise<void>;
  signOut: () => Promise<void>;
  view: <T = unknown>(method: string, args?: Record<string, unknown>) => Promise<T>;
  call: (method: string, args?: Record<string, unknown>, opts?: { gas?: string; deposit?: string }) => Promise<unknown>;
}

const Ctx = createContext<NearCtx | null>(null);

export function NearProvider({ children }: PropsWithChildren) {
  const connector = useMemo(
    () => new NearConnector({ network: NETWORK, providers: { testnet: RPC_URLS } }),
    []
  );
  const plugin = useMemo(
    () =>
      createAccessKeyPlugin({
        network: NETWORK,
        // One RPC only: with several, near-api-js's FailoverRpcProvider wraps
        // errors ("Exceeded N providers"), the plugin no longer recognises
        // AccessKeyDoesNotExist, and it throws instead of falling back to the
        // wallet (e.g. when a wallet such as MetaMask didn't add the key).
        providers: { testnet: [RPC_URLS[0]] },
        signIn: { contractId: CONTRACT_ID, methodNames: KEY_METHODS, allowance: "250000000000000000000000" },
      }),
    []
  );
  const provider = useMemo(() => new FailoverRpcProvider(RPC_URLS.map((url) => new JsonRpcProvider({ url }))), []);
  const [wallet, setWallet] = useState<Wallet | undefined>();
  const [walletAccount, setAccountId] = useState("");
  const [guest, setGuest] = useState<Guest | null>(() => (guestActive() ? loadGuest() : null));
  // a connected wallet wins over the guest
  const accountId = walletAccount || guest?.accountId || "";
  // read by call/callMany right after playAsGuest(), before React re-renders
  const guestRef = useRef(guest);
  guestRef.current = guest;
  const isGuest = !walletAccount && !!guest;
  const [ready, setReady] = useState(false);
  const pluginReady = useRef<Promise<void>>();

  useEffect(() => {
    let cancelled = false;
    const onIn = (p: EventMap["wallet:signIn"]) => {
      if (cancelled) return;
      setWallet(p.wallet);
      setAccountId(p.accounts[0]?.accountId ?? "");
    };
    const onOut = () => {
      if (cancelled) return;
      setWallet(undefined);
      setAccountId("");
    };
    (async () => {
      pluginReady.current ??= connector.use(plugin);
      await pluginReady.current.catch(() => undefined);
      const c = await connector.getConnectedWallet().catch(() => null);
      if (!cancelled && c) {
        setWallet(c.wallet);
        setAccountId(c.accounts[0]?.accountId ?? "");
      }
      connector.on("wallet:signIn", onIn);
      connector.on("wallet:signOut", onOut);
      if (!cancelled) setReady(true);
    })();
    return () => {
      cancelled = true;
      connector.off("wallet:signIn", onIn);
      connector.off("wallet:signOut", onOut);
    };
  }, [connector, plugin]);

  const playAsGuest = useCallback(async () => {
    const g = await createGuest();
    setGuestActive(true);
    guestRef.current = g;
    setGuest(g);
    return g.accountId;
  }, []);

  const signIn = useCallback(async () => {
    const w = await connector.connect();
    setWallet(w);
    const accounts = await w.getAccounts();
    setAccountId(accounts[0]?.accountId ?? "");
  }, [connector]);

  const signOut = useCallback(async () => {
    if (!wallet) {
      // the guest key stays in this browser, so "Play free" brings the same account back
      setGuestActive(false);
      guestRef.current = null;
      setGuest(null);
      return;
    }
    await connector.disconnect(wallet);
    setWallet(undefined);
    setAccountId("");
  }, [connector, wallet]);

  const view = useCallback(
    async <T,>(method: string, args: Record<string, unknown> = {}) =>
      (await provider.callFunction({ contractId: CONTRACT_ID, method, args })) as T,
    [provider]
  );

  const call = useCallback(
    async (method: string, args: Record<string, unknown> = {}, opts: { gas?: string; deposit?: string } = {}) => {
      const g = guestRef.current;
      if (!wallet && g) {
        const { hash } = await guestCall(g, [{ method, args, gas: opts.gas ? BigInt(opts.gas) : undefined }]);
        return hash;
      }
      if (!wallet) throw new Error("Connect a wallet first");
      const r = await wallet.signAndSendTransaction({
        receiverId: CONTRACT_ID,
        actions: [
          {
            type: "FunctionCall",
            params: { methodName: method, args, gas: opts.gas ?? "150000000000000", deposit: opts.deposit ?? "0" },
          },
        ],
      });
      return getTransactionLastResult(r);
    },
    [wallet, guest]
  );

  const callMany = useCallback(
    async (calls: Call[]) => {
      const g = guestRef.current;
      if (!wallet && g) {
        await guestCall(g, calls);
        return;
      }
      if (!wallet) throw new Error("Connect a wallet first");
      await wallet.signAndSendTransaction({
        receiverId: CONTRACT_ID,
        actions: calls.map((c) => ({
          type: "FunctionCall" as const,
          params: { methodName: c.method, args: c.args ?? {}, gas: String(c.gas ?? 50_000_000_000_000n), deposit: "0" },
        })),
      });
    },
    [wallet, guest]
  );

  const value = useMemo(
    () => ({ ready, accountId, isGuest, signIn, signOut, playAsGuest, view, call, callMany }),
    [ready, accountId, isGuest, signIn, signOut, playAsGuest, view, call, callMany]
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useNear(): NearCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error("useNear outside NearProvider");
  return c;
}
