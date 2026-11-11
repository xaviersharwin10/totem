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

type Wallet = Awaited<ReturnType<NearConnector["wallet"]>>;

export interface NearCtx {
  ready: boolean;
  accountId: string;
  signIn: () => Promise<void>;
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
        providers: { testnet: RPC_URLS },
        signIn: { contractId: CONTRACT_ID, methodNames: KEY_METHODS, allowance: "250000000000000000000000" },
      }),
    []
  );
  const provider = useMemo(() => new FailoverRpcProvider(RPC_URLS.map((url) => new JsonRpcProvider({ url }))), []);
  const [wallet, setWallet] = useState<Wallet | undefined>();
  const [accountId, setAccountId] = useState("");
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

  const signIn = useCallback(async () => {
    const w = await connector.connect();
    setWallet(w);
    const accounts = await w.getAccounts();
    setAccountId(accounts[0]?.accountId ?? "");
  }, [connector]);

  const signOut = useCallback(async () => {
    if (!wallet) return;
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
    [wallet]
  );

  const value = useMemo(() => ({ ready, accountId, signIn, signOut, view, call }), [ready, accountId, signIn, signOut, view, call]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useNear(): NearCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error("useNear outside NearProvider");
  return c;
}
