# Dynamic-Fee Research Hook for Uniswap v4

> **Research status:** experimental, unaudited Uniswap v4 dynamic-fee hook. It is **not** an insurance product, does not guarantee impermanent-loss compensation, and should not be treated as production-safe LP protection.

The hook explores a simple idea: raise the LP swap fee as the pool price moves farther from a stored reference price, with the goal of collecting more fee revenue during volatile periods.

Historical versions of this repository called the project the **“first-ever automated impermanent-loss protection hook”** and described some parameter settings as **“fully compensating IL.”** Those claims are withdrawn.

Dynamic fees for LP risk management are an explicit Uniswap v4 use case, and earlier/public work has explored volatility-based dynamic-fee hooks and impermanent-loss hedging/protection. Priority would require a dedicated prior-art analysis and cannot be inferred from this repository.

## Experimental deployment

A historical experimental deployment is referenced at:

`0x5330fe57f714966545Ff6FfAE402118BBc619480` on Arbitrum One.

The presence of a deployed contract does **not** imply audit, economic safety, profitability, or correctness of the protection model. Do not deposit funds based solely on this README or the included simulation.

## Intended mechanism

The source contract stores a reference `sqrtPriceX96` and, in `beforeSwap`, computes a divergence-like quantity from the current and reference values. It then maps that quantity to a fee override.

Conceptually:

```text
larger price divergence
        -> larger fee parameter
        -> more fee revenue per executed swap
```

This is best described as a **dynamic-fee experiment**, not as automatic IL reimbursement. The hook does not create an insurance reserve, hedge externally, or pay an explicit IL claim to LPs.

## Known methodology / implementation limitations

These limitations are material and should be understood before interpreting any result.

### 1. `sqrtPrice` is not the same as price

Uniswap represents pool price through `sqrtPriceX96`. The current contract compares ratios of `sqrtPriceX96` values and then labels the result as price divergence. A price ratio is the **square** of the corresponding sqrt-price ratio, so the current calculation is not a direct implementation of the README's historical price-divergence examples.

### 2. IL and fee quantities use different numerical scales

The contract computes an `ilBps`-named value and adds it directly to the v4 LP-fee integer. In Uniswap v4 fee units, `3000` represents 0.3%. A conventional basis-point quantity and the v4 fee integer are therefore not automatically interchangeable without an explicit conversion.

Because of this, `ilCoefficientBps = 10000` must **not** be interpreted as “100% IL compensation.” The economic meaning of the coefficient needs a corrected unit derivation and tests against the exact v4 fee semantics.

### 3. The included simulation double-counts fee revenue in its reported net return

`simulate.py` lets the AMM invariant `k` grow as fees are retained in the pool, so fee effects are already reflected in the simulated final pool value. It then adds `total_fees_earned` again when computing `net_return`.

That makes the historical simulation table an optimistic and currently invalid performance estimate. The previous statements that the dynamic version “outperforms in every scenario” or produces specific +9% / +17% improvements are withdrawn pending a repaired simulation.

### 4. The simulator is not a faithful Uniswap v4 concentrated-liquidity model

The simulation is a simplified constant-product / v2-style model with synthetic daily price paths. It does not model concentrated liquidity ranges, endogenous trade volume response to fees, routing, arbitrage competition, gas, MEV, liquidity migration, token-specific risks, or real v4 hook execution/accounting.

### 5. Higher fees can reduce volume

Increasing the fee per trade does not guarantee greater total fee revenue. Swappers and routers can choose competing pools/routes, so a valid economic test must model the fee/volume relationship rather than assume the same arbitrage flow at any fee.

## What the repository currently demonstrates

- a Solidity implementation of a per-swap fee override concept for Uniswap v4;
- use of v4 hook callbacks and pool state to derive an adaptive fee;
- an experimental Python simulator that can be repaired into a more rigorous research harness;
- a concrete basis for studying whether a divergence/volatility-aware fee rule can improve LP outcomes under specified assumptions.

## What is **not** established

- first-ever priority;
- guaranteed impermanent-loss protection;
- full or partial IL compensation at any coefficient setting;
- profitability or improved LP returns in live markets;
- safety of the deployed contract;
- audit status;
- robustness against manipulation of the reference/fee mechanism;
- superiority to other dynamic-fee, hedging, or insurance approaches.

## Prior-art context

Relevant public context includes:

- Uniswap v4's official dynamic-fee design, which explicitly discusses raising fees during high volatility to improve LP risk management;
- earlier dynamic-fee hook prototypes based on volatility/volume;
- Uniswap governance discussions about hedging impermanent loss, including proposals predating this repository's current claims;
- a 2026 BELTA Labs RFC describing an automated Uniswap v4 IL-hedging hook with dynamic fees plus external underwriting/hedging mechanisms.

Accordingly, this repository uses **no novelty or priority claim**.

## Research plan before any protection claim

A credible next validation should:

1. derive the fee formula in exact Uniswap v4 units;
2. convert `sqrtPriceX96` to the intended price/divergence measure correctly;
3. fix simulation fee accounting so revenue is counted once;
4. implement concentrated-liquidity accounting;
5. use real historical swap/price/volume data;
6. model volume/routing response to higher fees;
7. compare against fixed-fee and other adaptive-fee baselines on identical data;
8. preserve raw paths, trades, fees, LP values, and environment metadata;
9. add Solidity unit/fuzz/invariant tests;
10. obtain an independent smart-contract security review before production use.

## Build

```bash
npm install
npx hardhat compile
```

The Python simulation can be run with:

```bash
python simulate.py
```

Its current output is for debugging/research only and must not be used as a return forecast.

## References

- Uniswap v4 developer documentation: Dynamic Fees
- Uniswap Governance: 2024 RFC on hedging impermanent loss
- Uniswap Governance: 2026 BELTA Labs automated IL-protection RFC

## License status

`contracts/ILProtectionHookV4.sol` contains an `SPDX-License-Identifier: MIT` declaration. A repository-level `LICENSE` file is not currently committed, so do not assume that every repository file is covered by a complete project-wide license grant.
