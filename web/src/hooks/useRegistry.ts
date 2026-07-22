"use client";

import {
  useAccount,
  useReadContract,
  useWriteContract,
  usePublicClient,
  useWalletClient,
} from "wagmi";
import {
  intentRegistryAbi,
  mockRegistryAbi,
  erc20Abi,
  mockAmmAbi,
} from "@/lib/abi";
import { REGISTRY, TOKEN0, TOKEN1, EPOCH_STATE, DEMO_MODE } from "@/lib/config";
import { parseDeployEnv } from "@/lib/deployments";
import { encryptSignedAmount } from "@/lib/nox";
import { friendlyError } from "@/lib/errors";
import { useEnsureChain } from "@/hooks/useEnsureChain";
import { useMemo, useState } from "react";

export function displaySymbol(symbol: string): string {
  return symbol.replace(/^m/, "").replace(/^n/, "");
}

export function useAddresses() {
  // Stable object so consumers don't re-render solely due to new {} identity
  return useMemo(() => {
    const env = parseDeployEnv();
    return {
      registry: (REGISTRY ?? env.registry) as `0x${string}` | undefined,
      token0: (TOKEN0 ?? env.token0) as `0x${string}` | undefined,
      token1: (TOKEN1 ?? env.token1) as `0x${string}` | undefined,
      amm:
        (process.env.NEXT_PUBLIC_AMM_ADDRESS as `0x${string}` | undefined) ??
        undefined,
    };
  }, []);
}

export type EpochView = {
  state: number;
  openBlock: bigint;
  closeBlock: bigint;
  netSigned: bigint;
  netHandle: `0x${string}`;
  zeroForOne: boolean;
  absAmountIn: bigint;
  amountOut: bigint;
  participantCount: bigint;
};

export function useEpoch() {
  const { registry } = useAddresses();

  // Slow polls on public Sepolia — avoid 429 storms
  const pollMs = DEMO_MODE ? 5_000 : 15_000;

  const epochId = useReadContract({
    address: registry,
    abi: DEMO_MODE ? mockRegistryAbi : intentRegistryAbi,
    functionName: "currentEpochId",
    query: {
      enabled: !!registry,
      refetchInterval: pollMs,
      refetchOnWindowFocus: false,
      retry: 1,
    },
  });

  const mockEpoch = useReadContract({
    address: registry,
    abi: mockRegistryAbi,
    functionName: "getEpoch",
    args: epochId.data !== undefined ? [epochId.data] : undefined,
    query: {
      enabled: DEMO_MODE && !!registry && epochId.data !== undefined,
      refetchInterval: pollMs,
      refetchOnWindowFocus: false,
      retry: 1,
    },
  });

  const noxEpoch = useReadContract({
    address: registry,
    abi: intentRegistryAbi,
    functionName: "epochs",
    args: epochId.data !== undefined ? [epochId.data] : undefined,
    query: {
      enabled: !DEMO_MODE && !!registry && epochId.data !== undefined,
      refetchInterval: pollMs,
      refetchOnWindowFocus: false,
      retry: 1,
    },
  });

  const epoch: EpochView | undefined = useMemo(() => {
    if (DEMO_MODE && mockEpoch.data) {
      const e = mockEpoch.data;
      return {
        state: e.state,
        openBlock: e.openBlock,
        closeBlock: e.closeBlock,
        netSigned: e.netSigned,
        netHandle: e.netHandle,
        zeroForOne: e.zeroForOne,
        absAmountIn: e.absAmountIn,
        amountOut: e.amountOut,
        participantCount: e.participantCount,
      };
    }
    if (!DEMO_MODE && noxEpoch.data) {
      // public mapping returns full Epoch struct (11 fields with buy/sell escrow)
      const arr = noxEpoch.data as unknown as readonly unknown[];
      if (Array.isArray(arr) && arr.length >= 9) {
        return {
          state: Number(arr[0]),
          openBlock: arr[1] as bigint,
          closeBlock: arr[2] as bigint,
          netSigned: 0n, // only after publicDecrypt
          netHandle: arr[4] as `0x${string}`,
          zeroForOne: Boolean(arr[5]),
          absAmountIn: arr[6] as bigint,
          amountOut: arr[7] as bigint,
          participantCount: arr[8] as bigint,
        };
      }
    }
    return undefined;
  }, [mockEpoch.data, noxEpoch.data]);

  return {
    registry,
    epochId: epochId.data,
    epoch,
    stateLabel:
      epoch !== undefined ? EPOCH_STATE[epoch.state] ?? "Unknown" : "—",
    demoMode: DEMO_MODE,
    refetch: () => {
      epochId.refetch();
      mockEpoch.refetch();
      noxEpoch.refetch();
    },
  };
}

export function useSubmitIntent() {
  const { registry, token0, token1 } = useAddresses();
  const { address } = useAccount();
  const { writeContractAsync, isPending, error } = useWriteContract();
  const publicClient = usePublicClient();
  const { data: walletClient } = useWalletClient();
  const { ensureChain } = useEnsureChain();
  const [phase, setPhase] = useState<
    "idle" | "switching" | "encrypting" | "approving" | "submitting"
  >("idle");

  async function submit(params: {
    direction: "buy" | "sell";
    amount: bigint;
  }) {
    if (!registry || !token0 || !token1 || !address) {
      throw new Error("Missing registry/token addresses or wallet");
    }
    const tokenIn = params.direction === "buy" ? token0 : token1;
    const signed =
      params.direction === "buy" ? params.amount : -params.amount;

    try {
      // Never call Hardhat addresses while wallet is on Base/mainnet
      setPhase("switching");
      await ensureChain();

      setPhase("approving");
      const allowance = await publicClient!.readContract({
        address: tokenIn,
        abi: erc20Abi,
        functionName: "allowance",
        args: [address, registry],
      });
      if (allowance < params.amount) {
        const approveHash = await writeContractAsync({
          address: tokenIn,
          abi: erc20Abi,
          functionName: "approve",
          args: [registry, params.amount],
        });
        await publicClient!.waitForTransactionReceipt({ hash: approveHash });
      }

      if (DEMO_MODE) {
        setPhase("submitting");
        const hash = await writeContractAsync({
          address: registry,
          abi: mockRegistryAbi,
          functionName: "submitIntent",
          args: [signed, params.amount],
        });
        await publicClient!.waitForTransactionReceipt({ hash });
        setPhase("idle");
        return hash;
      }

      if (!walletClient) throw new Error("Wallet client unavailable");
      setPhase("encrypting");
      const { handle, handleProof } = await encryptSignedAmount(
        walletClient,
        signed,
        registry
      );

      setPhase("submitting");
      const hash = await writeContractAsync({
        address: registry,
        abi: intentRegistryAbi,
        functionName: "submitIntent",
        args: [handle, handleProof, tokenIn, params.amount],
      });
      await publicClient!.waitForTransactionReceipt({ hash });
      setPhase("idle");
      return hash;
    } catch (e) {
      setPhase("idle");
      throw new Error(friendlyError(e));
    }
  }

  return {
    submit,
    isPending: isPending || phase !== "idle",
    phase,
    error,
  };
}

export function useMyIntents(epochId?: bigint) {
  const { registry } = useAddresses();
  const { address } = useAccount();
  const ids = useReadContract({
    address: registry,
    abi: DEMO_MODE ? mockRegistryAbi : intentRegistryAbi,
    functionName: "getTraderIntentIds",
    args: address && epochId !== undefined ? [address, epochId] : undefined,
    query: {
      enabled: !!registry && !!address && epochId !== undefined,
      refetchInterval: DEMO_MODE ? 8_000 : 20_000,
      refetchOnWindowFocus: false,
      retry: 1,
    },
  });

  return {
    intentIds: ids.data ?? [],
    refetch: ids.refetch,
  };
}

export function useIntent(epochId?: bigint, intentId?: bigint) {
  const { registry } = useAddresses();

  const mock = useReadContract({
    address: registry,
    abi: mockRegistryAbi,
    functionName: "getIntent",
    args:
      epochId !== undefined && intentId !== undefined
        ? [epochId, intentId]
        : undefined,
    query: {
      enabled:
        DEMO_MODE &&
        !!registry &&
        epochId !== undefined &&
        intentId !== undefined,
    },
  });

  const nox = useReadContract({
    address: registry,
    abi: intentRegistryAbi,
    functionName: "intents",
    args:
      epochId !== undefined && intentId !== undefined
        ? [epochId, intentId]
        : undefined,
    query: {
      enabled:
        !DEMO_MODE &&
        !!registry &&
        epochId !== undefined &&
        intentId !== undefined,
    },
  });

  return useMemo(() => {
    if (DEMO_MODE && mock.data) {
      return {
        trader: mock.data.trader,
        handle: mock.data.handle,
        signedAmount: mock.data.signedAmount as bigint | undefined,
        tokenIn: mock.data.tokenIn,
        escrowed: mock.data.escrowed,
        settled: mock.data.settled,
      };
    }
    if (!DEMO_MODE && nox.data) {
      const arr = nox.data as unknown as readonly unknown[];
      if (Array.isArray(arr) && arr.length >= 5) {
        return {
          trader: arr[0] as `0x${string}`,
          handle: arr[1] as `0x${string}`,
          signedAmount: undefined as bigint | undefined,
          tokenIn: arr[2] as `0x${string}`,
          escrowed: arr[3] as bigint,
          settled: arr[4] as boolean,
        };
      }
    }
    return null;
  }, [mock.data, nox.data]);
}

export function formatAmount(amount: bigint, decimals: number, maxFrac = 4) {
  const neg = amount < 0n;
  const v = neg ? -amount : amount;
  const base = 10n ** BigInt(decimals);
  const whole = v / base;
  const frac = (v % base)
    .toString()
    .padStart(decimals, "0")
    .slice(0, maxFrac)
    .replace(/0+$/, "");
  return `${neg ? "-" : ""}${whole}${frac ? `.${frac}` : ""}`;
}

export function parseAmount(input: string, decimals: number): bigint {
  const cleaned = input.trim();
  if (!cleaned || cleaned === ".") return 0n;
  const [whole, frac = ""] = cleaned.split(".");
  const fracPadded = (frac + "0".repeat(decimals)).slice(0, decimals);
  return (
    BigInt(whole || "0") * 10n ** BigInt(decimals) + BigInt(fracPadded || "0")
  );
}

export function useTokenMeta() {
  const { token0, token1 } = useAddresses();
  const s0 = useReadContract({
    address: token0,
    abi: erc20Abi,
    functionName: "symbol",
    query: { enabled: !!token0 },
  });
  const s1 = useReadContract({
    address: token1,
    abi: erc20Abi,
    functionName: "symbol",
    query: { enabled: !!token1 },
  });
  const d0 = useReadContract({
    address: token0,
    abi: erc20Abi,
    functionName: "decimals",
    query: { enabled: !!token0 },
  });
  const d1 = useReadContract({
    address: token1,
    abi: erc20Abi,
    functionName: "decimals",
    query: { enabled: !!token1 },
  });
  return useMemo(
    () => ({
      symbol0: displaySymbol(s0.data ?? "USDC"),
      symbol1: displaySymbol(s1.data ?? "WETH"),
      decimals0: d0.data ?? 6,
      decimals1: d1.data ?? 18,
    }),
    [s0.data, s1.data, d0.data, d1.data]
  );
}

export function useBalances() {
  const { address } = useAccount();
  const { token0, token1 } = useAddresses();
  const b0 = useReadContract({
    address: token0,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    query: {
      enabled: !!token0 && !!address,
      refetchInterval: 20_000,
      refetchOnWindowFocus: false,
      retry: 1,
    },
  });
  const b1 = useReadContract({
    address: token1,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    query: {
      enabled: !!token1 && !!address,
      refetchInterval: 20_000,
      refetchOnWindowFocus: false,
      retry: 1,
    },
  });
  return {
    balance0: b0.data ?? 0n,
    balance1: b1.data ?? 0n,
    refetch: () => {
      b0.refetch();
      b1.refetch();
    },
  };
}

export function useQuote(amountIn: bigint, zeroForOne: boolean) {
  const { amm } = useAddresses();
  const r0 = useReadContract({
    address: amm,
    abi: mockAmmAbi,
    functionName: "reserve0",
    query: {
      enabled: !!amm && DEMO_MODE,
      refetchInterval: 30_000,
      refetchOnWindowFocus: false,
    },
  });
  const r1 = useReadContract({
    address: amm,
    abi: mockAmmAbi,
    functionName: "reserve1",
    query: {
      enabled: !!amm && DEMO_MODE,
      refetchInterval: 30_000,
      refetchOnWindowFocus: false,
    },
  });

  return useMemo(() => {
    if (!amountIn || amountIn <= 0n) return null;
    const reserveIn = zeroForOne ? r0.data : r1.data;
    const reserveOut = zeroForOne ? r1.data : r0.data;
    if (!reserveIn || !reserveOut || reserveIn === 0n || reserveOut === 0n) {
      // Sepolia: rough mid ~2000 USDC/WETH for UX only
      if (zeroForOne) return (amountIn * 10n ** 12n) / 2000n;
      return (amountIn * 2000n) / 10n ** 12n;
    }
    const amountInWithFee = amountIn * 997n;
    return (
      (amountInWithFee * reserveOut) / (reserveIn * 1000n + amountInWithFee)
    );
  }, [amountIn, zeroForOne, r0.data, r1.data]);
}
