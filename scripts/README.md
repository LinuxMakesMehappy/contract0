# Flexible Staking CLI

This CLI tool allows users to interact with the Flexible Tiered Yield Protocol (FTYP) directly from the command line, enabling custom staking durations and reward distribution preferences.

## Features

- ✅ **Custom Duration Staking**: Choose any number of days (1-3650)
- ✅ **Early Exit Penalties**: Automatic penalty calculation for early withdrawals
- ✅ **Reward Preferences**: Set recurring investment or batch distribution modes
- ✅ **Stake Information**: View current stake details and penalties
- ✅ **CLI Integration**: Works with standard Solana CLI tools

## Installation

### Prerequisites
```bash
# Install dependencies
npm install @solana/web3.js @coral-xyz/anchor ts-node

# Build the program
anchor build

# Generate TypeScript types
anchor build && anchor idl init --filepath target/idl/kamino_lending.json Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS
```

### Environment Setup
```bash
# Set your Solana RPC endpoint
export SOLANA_RPC_URL="https://api.mainnet-beta.solana.com"

# Set your wallet path (optional, defaults to ~/.config/solana/id.json)
export SOLANA_WALLET_PATH="/path/to/your/wallet.json"
```

## Usage

### Basic Commands

#### 1. Stake SOL with Custom Duration
```bash
# Stake 10 SOL for 1 day (default)
ts-node stake-cli.ts stake 10 Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS

# Stake 10 SOL for 30 days
ts-node stake-cli.ts stake 10 30 Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS

# Stake 5 SOL for 90 days
ts-node stake-cli.ts stake 5 90 Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS

# Stake 1 SOL for 365 days (1 year)
ts-node stake-cli.ts stake 1 365 Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS
```

#### 2. Withdraw Stake
```bash
# Withdraw stake (with early exit penalty if applicable)
ts-node stake-cli.ts withdraw Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS
```

#### 3. View Stake Information
```bash
# Show current stake details
ts-node stake-cli.ts info

# Show stake info for specific account
ts-node stake-cli.ts info <user-account-address>
```

#### 4. Set Reward Preferences
```bash
# Set recurring investment mode
ts-node stake-cli.ts preferences recurring 30 --reinvestment 80

# Set batch distribution mode
ts-node stake-cli.ts preferences batch 60 --batch-size 1
```

### Advanced Examples

#### Custom Duration Staking
```bash
# Stake for exactly 45 days
ts-node stake-cli.ts stake 2.5 45 Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS

# Stake for 180 days (6 months)
ts-node stake-cli.ts stake 15 180 Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS

# Stake for 730 days (2 years)
ts-node stake-cli.ts stake 25 730 Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS
```

#### Reward Distribution Preferences
```bash
# 100% compound reinvestment
ts-node stake-cli.ts preferences recurring 90 --reinvestment 100

# 50% reinvestment with batch distribution
ts-node stake-cli.ts preferences batch 30 --batch-size 0.5

# 80% reinvestment for long-term staking
ts-node stake-cli.ts preferences recurring 365 --reinvestment 80
```

## Duration Options

### Predefined Durations (Web App)
- **1 Day**: Default lock period
- **7 Days**: Short-term testing
- **14 Days**: Two-week lock
- **30 Days**: Monthly lock
- **60 Days**: Two-month lock
- **90 Days**: Quarterly lock
- **180 Days**: Six-month lock
- **365 Days**: Annual lock

### Custom Durations (CLI)
- **Default**: 1 day (if not specified)
- **Range**: 1-3650 days (10 years max)
- **Flexibility**: Any number of days
- **Examples**: 45, 120, 500, 1000 days

## Early Exit Penalties

### Penalty Calculation
```typescript
// Early exit penalty formula
const penalty = realizedRewards * tierPenaltyMultiplier / 100

// Where:
// realizedRewards = stakeAmount * baseRate * timeElapsed * tierMultiplier
// tierPenaltyMultiplier = Diamond(120%), Gold(110%), Silver(100%), Bronze(90%)
```

### Example Scenarios

#### Scenario 1: Full Term Completion
```bash
# Stake 10 SOL for 30 days, complete full term
ts-node stake-cli.ts stake 10 30 Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS
# Wait 30 days
ts-node stake-cli.ts withdraw Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS
# Result: No penalty, full withdrawal
```

#### Scenario 2: Early Exit (50% through)
```bash
# Stake 10 SOL for 30 days
ts-node stake-cli.ts stake 10 30 Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS
# Wait 15 days (50% through)
ts-node stake-cli.ts withdraw Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS
# Result: Penalty = realized rewards * tier multiplier
```

#### Scenario 3: Very Early Exit (10% through)
```bash
# Stake 10 SOL for 30 days
ts-node stake-cli.ts stake 10 30 Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS
# Wait 3 days (10% through)
ts-node stake-cli.ts withdraw Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS
# Result: Higher penalty due to early exit
```

## Tier System

### Tier Multipliers
- **Diamond**: 1.5x reward multiplier, 1.2x penalty multiplier
- **Gold**: 1.25x reward multiplier, 1.1x penalty multiplier
- **Silver**: 1.0x reward multiplier, 1.0x penalty multiplier
- **Bronze**: 0.75x reward multiplier, 0.9x penalty multiplier

### Tier Progression
```bash
# View current tier
ts-node stake-cli.ts info

# Tiers are automatically calculated based on:
# - Liquidity provided
# - Loyalty (time in protocol)
# - Frequency of interactions
# - Amount staked
```

## Integration with Solana CLI

### Using with Solana CLI
```bash
# Check balance before staking
solana balance

# Stake using CLI
ts-node stake-cli.ts stake 5 30 Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS

# Check transaction
solana confirm <transaction-signature>

# View stake info
ts-node stake-cli.ts info

# Withdraw when ready
ts-node stake-cli.ts withdraw Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS
```

### Script Automation
```bash
#!/bin/bash
# stake-script.sh

# Set environment
export SOLANA_RPC_URL="https://api.mainnet-beta.solana.com"

# Stake 10 SOL for 90 days
echo "Staking 10 SOL for 90 days..."
ts-node stake-cli.ts stake 10 90 Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS

# Set preferences
echo "Setting reward preferences..."
ts-node stake-cli.ts preferences recurring 90 --reinvestment 80

# Show info
echo "Stake information:"
ts-node stake-cli.ts info
```

## Error Handling

### Common Errors
```bash
# Insufficient balance
❌ Error: Insufficient balance for transaction

# Invalid duration
❌ Error: Duration must be between 1 and 3650 days

# Early exit penalty
⚠️ Early exit penalty applies. You will receive X.XXXX SOL instead of Y.YYYY SOL.

# Network issues
❌ Error: Connection failed. Check SOLANA_RPC_URL
```

### Troubleshooting
```bash
# Check wallet balance
solana balance

# Verify network connection
solana cluster-version

# Check program deployment
solana program show Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS

# View recent transactions
solana transaction-history <wallet-address>
```

## Security Considerations

### Wallet Security
- ✅ Use hardware wallets for large amounts
- ✅ Keep private keys secure
- ✅ Use dedicated staking wallets
- ✅ Regularly backup wallet files

### Transaction Safety
- ✅ Verify transaction details before signing
- ✅ Check early exit penalties before withdrawing
- ✅ Use testnet for testing new features
- ✅ Monitor stake status regularly

## Advanced Features

### Batch Operations
```bash
# Stake multiple amounts with different durations
for amount in 1 2 5 10; do
  for days in 30 60 90; do
    ts-node stake-cli.ts stake $amount $days Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS
  done
done
```

### Monitoring Script
```bash
#!/bin/bash
# monitor-stakes.sh

while true; do
  echo "=== $(date) ==="
  ts-node stake-cli.ts info
  echo "=================="
  sleep 3600  # Check every hour
done
```

This CLI provides full flexibility for users who prefer command-line interfaces while maintaining all the features of the web application! 🚀
