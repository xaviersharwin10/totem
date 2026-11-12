// NEAR wallet + RPC context. Follows the official near-examples frontend
// (NEAR Connect + near-api-js). NEAR Wallet Selector is deprecated per the docs.
//
// The function-call key plugin adds a limited key for this contract at sign-in,
// so feeding / poking / the faucet sign in the browser without a wallet popup.

import { createContext, PropsWithChildren, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { FailoverRpcProvider, JsonRpcProvider, KeyPair, KeyPairSigner, type KeyPairString, getTransactionLastResult } from "near-api-js";
import { NearConnector, type EventMap } from "@hot-labs/near-connect";
import { createAccessKeyPlugin } from "function-call-key-plugin";
import { CONTRACT_ID, KEY_METHODS, NETWORK, RPC_URLS } from "./config";
import { Call, Guest, createGuest, guestCall, loadGuest, restoreGuest } from "./guest";

/** Proof that the player owns the account, for server/auth.ts. */
export interface SignedProof {
  accountId: string;
  publicKey?: string;
  signature: string;
  scheme?: "nep413" | "eth";
}
const ETH_ACCOUNT = /^0x[0-9a-f]{40}$/;
/** The words an Ethereum wallet signs (must match ethText in server/auth.ts). */
const ethText = (message: string, recipient: string, nonce: Uint8Array) =>
  `${message}\n\nFor: ${recipient}\nNonce: ${Array.from(nonce, (b) => b.toString(16).padStart(2, "0")).join("")}`;

/** A fresh 32-byte nonce whose first 8 bytes are the time (the server refuses stale ones). */
export function freshNonce(): { bytes: Uint8Array; b64: string } {
  const bytes = new Uint8Array(32);
  new DataView(bytes.buffer).setBigUint64(0, BigInt(Date.now()));
  crypto.getRandomValues(bytes.subarray(8));
  let bin = "";
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return { bytes, b64: btoa(bin) };
}

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
  /** true when the server has a relayer configured, so free guest play is offered */
  freePlay: boolean;
  signIn: () => Promise<void>;
  /** Start (or resume) a free guest account: no wallet, no NEAR needed. */
  playAsGuest: () => Promise<string>;
  /** Continue a guest from another browser with its backup code. */
  restoreGuestCode: (code: string) => Promise<string>;
  /** The guest in this browser, for its backup code (null with a wallet). */
  guest: Guest | null;
  /** A call to another contract (the tribe's DAO). Guests: zero-deposit only, relayed. */
  callAt: (receiverId: string, method: string, args: Record<string, unknown>, opts?: { gas?: string; deposit?: string }) => Promise<unknown>;
  /** Several calls in one go (one meta-transaction for guests, one wallet tx otherwise). */
  callMany: (calls: Call[]) => Promise<void>;
  signOut: () => Promise<void>;
  view: <T = unknown>(method: string, args?: Record<string, unknown>) => Promise<T>;
  viewAt: <T = unknown>(contractId: string, method: string, args?: Record<string, unknown>) => Promise<T>;
  call: (method: string, args?: Record<string, unknown>, opts?: { gas?: string; deposit?: string }) => Promise<unknown>;
  /** Sign a NEP-413 message (proves you own the account; nothing is sent to the chain). */
  signMessage: (message: string, recipient: string, nonce: Uint8Array) => Promise<SignedProof>;
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
  // Ask the server once whether free guest play is available (relayer configured).
  const [freePlay, setFreePlay] = useState(false);
  useEffect(() => {
    let off = false;
    fetch("/api/guest")
      .then((r) => r.json())
      .then((j: { available?: boolean }) => !off && setFreePlay(!!j.available))
      .catch(() => !off && setFreePlay(false));
    return () => {
      off = true;
    };
  }, []);
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

  const restoreGuestCode = useCallback(async (code: string) => {
    const g = await restoreGuest(code);
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
  const viewAt = useCallback(
    async <T,>(contractId: string, method: string, args: Record<string, unknown> = {}) =>
      (await provider.callFunction({ contractId, method, args })) as T,
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

  const callAt = useCallback(
    async (receiverId: string, method: string, args: Record<string, unknown>, opts: { gas?: string; deposit?: string } = {}) => {
      const g = guestRef.current;
      if (!wallet && g) {
        if (opts.deposit && opts.deposit !== "0") throw new Error("Guests can't attach NEAR");
        const { hash } = await guestCall(g, [{ method, args, gas: opts.gas ? BigInt(opts.gas) : undefined }], receiverId);
        return hash;
      }
      if (!wallet) throw new Error("Connect a wallet first");
      const r = await wallet.signAndSendTransaction({
        receiverId,
        actions: [
          {
            type: "FunctionCall",
            params: { methodName: method, args, gas: opts.gas ?? "100000000000000", deposit: opts.deposit ?? "0" },
          },
        ],
      });
      return getTransactionLastResult(r);
    },
    [wallet]
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

  const signMessage = useCallback(
    async (message: string, recipient: string, nonce: Uint8Array) => {
      const g = guestRef.current;
      if (!wallet && g) {
        // a guest signs with its own key, kept in this browser
        const s = await new KeyPairSigner(KeyPair.fromString(g.secretKey as KeyPairString)).signNep413Message(g.accountId, { message, recipient, nonce });
        const sig = s.signature as unknown as Uint8Array | { data: Uint8Array };
        const bytes = sig instanceof Uint8Array ? sig : sig.data;
        let bin = "";
        bytes.forEach((b) => (bin += String.fromCharCode(b)));
        return { accountId: g.accountId, publicKey: s.publicKey.toString(), signature: btoa(bin) };
      }
      if (!wallet) throw new Error("Connect a wallet first");
      // MetaMask-style NEAR accounts (0x…) can't do NEP-413: they sign the same
      // words with Ethereum's personal_sign, and the server recovers the address.
      if (ETH_ACCOUNT.test(walletAccount)) {
        const eth = (window as unknown as { ethereum?: { request: (a: { method: string; params?: unknown[] }) => Promise<unknown> } }).ethereum;
        if (!eth) throw new Error("Open this page in the browser where your Ethereum wallet (MetaMask) is installed, then try again.");
        const text = ethText(message, recipient, nonce);
        const hex = "0x" + Array.from(new TextEncoder().encode(text), (b) => b.toString(16).padStart(2, "0")).join("");
        const accounts = (await eth.request({ method: "eth_requestAccounts" })) as string[];
        if (!accounts.some((x) => x.toLowerCase() === walletAccount)) throw new Error(`Switch MetaMask to ${walletAccount} and try again.`);
        const signature = (await eth.request({ method: "personal_sign", params: [hex, walletAccount] })) as string;
        return { accountId: walletAccount, signature, scheme: "eth" as const };
      }
      const r = await wallet.signMessage({ message, recipient, nonce });
      if (!r?.signature) throw new Error("This wallet can't sign messages. Try a NEAR wallet (HOT, Meteor) or play as a guest.");
      return { accountId: r.accountId, publicKey: r.publicKey, signature: r.signature };
    },
    [wallet, guest, walletAccount]
  );

  const value = useMemo(
    () => ({ ready, accountId, isGuest, freePlay, guest: isGuest ? guest : null, signIn, signOut, playAsGuest, restoreGuestCode, view, viewAt, call, callAt, callMany, signMessage }),
    [ready, accountId, isGuest, freePlay, guest, signIn, signOut, playAsGuest, restoreGuestCode, view, viewAt, call, callAt, callMany, signMessage]
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useNear(): NearCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error("useNear outside NearProvider");
  return c;
}
