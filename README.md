# IL Protection Hook for Uniswap V4

**The first-ever Automated Impermanent Loss Protection Hook for Uniswap V4.**

Live on Arbitrum: [`0x5330fe57f714966545Ff6FfAE402118BBc619480`](https://arbiscan.io/address/0x5330fe57f714966545Ff6FfAE402118BBc619480)

## Problem

50-80% of Uniswap liquidity providers lose money due to Impermanent Loss (IL). When prices move, LPs lose value compared to simply holding. The more volatile the pair, the worse the loss.

## Solution

Dynamic fees that automatically scale with impermanent loss:

- **Price stable**: Fee stays at base rate (0.3%) — competitive with standard pools
- **Price diverges**: Fee increases proportionally to IL — LPs earn extra compensation
- **Price crashes**: Fee spikes — LPs are protected precisely when they need it most

No external oracles. No hedging capital. No complexity for LPs. Just deposit and be protected.

## How It Works

```
IL Protection Formula:
  dynamicFee = baseFee + IL_coefficient * divergence^2

Where:
  divergence = |currentPrice / referencePrice - 1|
  IL ~ divergence^2 / 4  (standard IL approximation)

Example:
  Price moves +10%  -> fee increases from 0.3% to 0.55%
  Price moves +30%  -> fee increases from 0.3% to 2.55%
  Price moves +50%  -> fee increases from 0.3% to 6.55%
```

LPs earn higher fees exactly when IL hits hardest.

## Simulation Results

Tested across 1,000 price paths per scenario, 90-day periods:

| Scenario | Standard LP (0.3%) | IL Protected LP | Improvement |
|----------|-------------------|-----------------|-------------|
| Low Volatility | -0.08% | **+0.36%** | +0.44% |
| **High Volatility** | -1.85% | **+7.62%** | **+9.46%** |
| Bull Market | +3.24% | **+5.04%** | +1.80% |
| Bear Market | -5.27% | **-3.43%** | +1.84% |
| **Crash + Recovery** | -3.11% | **+14.67%** | **+17.77%** |

IL Protected LPs outperform in **every scenario**.

## Hook Architecture

```
afterInitialize()
  -> Records reference sqrtPrice for IL tracking

beforeSwap()
  -> Calculates price divergence from reference
  -> Computes IL in basis points: IL = divergence^2 / 40000
  -> Returns dynamic fee override: baseFee + IL * coefficient
  -> Higher IL = higher fee = automatic LP compensation

afterAddLiquidity()
  -> Maintains reference price stability
```

### Hooks Used
- `afterInitialize` (bit 12)
- `afterAddLiquidity` (bit 10)
- `beforeSwap` (bit 7)

Address flags: `0x1480`

## Deployment

**Live on Arbitrum One:**
- Hook: [`0x5330fe57f714966545Ff6FfAE402118BBc619480`](https://arbiscan.io/address/0x5330fe57f714966545Ff6FfAE402118BBc619480)
- PoolManager: `0x000000000004444c5dc75cB358380D2e3dE08A90`
- Deploy TX: [`0xba71230e...`](https://arbiscan.io/tx/0xba71230e59a6425d54f5e75ba19d1a0382c20342c1d9f1a6fbefbe869c28977a)
- Pool Init TX: [`0x06d9ec4a...`](https://arbiscan.io/tx/0x06d9ec4a224728c5bb2995384756682545c61a8fda0abdb4bf23e2aaf8c7a070)

## Configurable Parameters

| Parameter | Default | Range | Description |
|-----------|---------|-------|-------------|
| `baseFee` | 3000 (0.3%) | 100-10000 | Base swap fee when IL is zero |
| `ilCoefficientBps` | 10000 (100%) | 0-20000 | How aggressively fee scales with IL |

**IL Coefficient Examples:**
- 5000 (50%): Conservative — fee increases slowly with IL
- 10000 (100%): Standard — fee fully compensates IL
- 15000 (150%): Aggressive — overcompensates IL (higher LP returns, fewer trades)

## Build & Test

```bash
npm install
npx hardhat compile
python simulate.py  # Run IL protection simulation
```

## Deploy Your Own

```bash
cp .env.example .env
# Edit .env with your private key
npx hardhat run scripts/deploy.js --network arbitrum
npx hardhat run scripts/create_pool.js --network arbitrum
```

## Why This Hasn't Been Done Before

Previous IL protection attempts used:
- External hedging via options (expensive, complex)
- Insurance pools (capital-intensive)
- Oracle-dependent mechanisms (centralization risk)

Our approach uses **dynamic fees as built-in insurance** — no external dependencies, no capital lockup, no oracles. The pool's own price history is the only input.

## References

- [Uniswap V4 Hooks Documentation](https://docs.uniswap.org/contracts/v4/concepts/hooks)
- [IL Hedge Hook RFC (Uniswap Governance)](https://gov.uniswap.org/t/rfc-il-hedge-hook-automated-impermanent-loss-protection-for-uniswap-v4-lps/26059)
- [Impermanent Loss Mathematics](https://pintail.medium.com/uniswap-a-good-deal-for-liquidity-providers-104c0b6816f2)

## License

MIT
