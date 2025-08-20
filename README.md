# Kamino-Style Lending Smart Contract

A Solana smart contract implementing Kamino Finance-style lending with multiply (leverage) functionality using Anchor framework.

## 🚀 Features

- **Lending Market**: Deposit and borrow tokens with interest accrual
- **Multiply Strategy**: Flash loan functionality for leveraged positions
- **Liquidation**: Automatic liquidation of undercollateralized positions
- **Interest Rate Model**: Dynamic interest rates based on utilization
- **Collateral Management**: LTV ratios and liquidation thresholds
- **Flash Loans**: Atomic borrowing for multiply strategies

## 📋 Prerequisites

- Rust 1.70+
- Solana CLI 1.17+
- Anchor CLI 0.29+
- Node.js 18+

## 🛠️ Installation

1. **Install Anchor CLI**:
```bash
cargo install --git https://github.com/coral-xyz/anchor avm --locked --force
avm install latest
avm use latest
```

2. **Install Solana CLI**:
```bash
sh -c "$(curl -sSfL https://release.solana.com/v1.17.0/install)"
```

3. **Build the program**:
```bash
anchor build
```

## 🏗️ Program Structure

### Core Instructions

1. **`initialize_market`** - Initialize the lending market
2. **`add_reserve`** - Add a new token reserve to the market
3. **`deposit`** - Deposit tokens into a reserve
4. **`borrow`** - Borrow tokens from a reserve
5. **`repay`** - Repay borrowed tokens
6. **`withdraw`** - Withdraw deposited tokens
7. **`liquidate`** - Liquidate undercollateralized positions
8. **`flash_loan`** - Execute flash loans for multiply strategies

### Account Structures

- **`Market`** - Global market state and parameters
- **`Reserve`** - Individual token reserve with rates and limits
- **`UserAccount`** - User's deposits and borrows across all reserves

## 💡 Multiply Strategy Implementation

The contract includes flash loan functionality to enable Kamino-style multiply strategies:

```rust
// Flash loan for multiply strategy
pub fn flash_loan(
    ctx: Context<FlashLoan>,
    amount: u64,
    fee: u64,
) -> Result<()> {
    // 1. Transfer tokens to borrower
    // 2. Borrower executes strategy (swap, deposit, etc.)
    // 3. Transfer back borrowed amount + fee
    // 4. Update reserve with fee
}
```

### Typical Multiply Flow:
1. **Flash Loan**: Borrow tokens temporarily
2. **Swap**: Convert to yield-bearing asset (e.g., SOL → JitoSOL)
3. **Deposit**: Supply as collateral to borrow more
4. **Repay**: Close flash loan atomically
5. **Result**: Leveraged exposure to yield

## 🔧 Configuration

### Interest Rate Model
```rust
InterestRateModel {
    base_rate: 500,        // 5% base rate
    multiplier: 2000,      // 20% multiplier
    jump_multiplier: 5000, // 50% jump multiplier
    kink: 8000,           // 80% utilization kink
}
```

### Reserve Parameters
- **LTV Ratio**: Loan-to-value ratio (e.g., 75%)
- **Liquidation Threshold**: Threshold for liquidation (e.g., 80%)
- **Liquidation Penalty**: Bonus for liquidators (e.g., 5%)

## 🧪 Testing

```bash
# Run tests
anchor test

# Test specific file
anchor test --skip-local-validator

# Test with logs
anchor test --skip-local-validator -- --nocapture
```

## 🚀 Deployment

### Local Development
```bash
# Start local validator
solana-test-validator

# Deploy to localnet
anchor deploy
```

### Devnet
```bash
# Set cluster to devnet
solana config set --url devnet

# Deploy to devnet
anchor deploy --provider.cluster devnet
```

### Mainnet
```bash
# Set cluster to mainnet
solana config set --url mainnet-beta

# Deploy to mainnet (BE CAREFUL!)
anchor deploy --provider.cluster mainnet
```

## 📊 Key Metrics

- **Total Value Locked (TVL)**: Sum of all deposits
- **Utilization Rate**: Total borrows / Total deposits
- **Interest Rates**: Dynamic based on utilization
- **Liquidation Risk**: Based on LTV and price movements

## ⚠️ Security Considerations

- **Audit Required**: This is educational code - audit before production
- **Price Oracles**: Implement proper price feeds for accurate valuations
- **Rate Limiting**: Add rate limiting to prevent abuse
- **Emergency Pause**: Add ability to pause operations
- **Access Control**: Proper authority management

## 🔍 Monitoring

### Health Checks
- Monitor utilization rates
- Track liquidation events
- Watch for undercollateralized positions
- Monitor flash loan usage

### Risk Metrics
- LTV ratios across all positions
- Interest rate spreads
- Liquidation queue
- Reserve health scores

## 📚 Resources

- [Anchor Documentation](https://www.anchor-lang.com/)
- [Solana Program Library](https://spl.solana.com/)
- [Kamino Finance](https://kamino.finance/)
- [Solana Cookbook](https://solanacookbook.com/)

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests
5. Submit a pull request

## 📄 License

MIT License - see LICENSE file for details

## ⚠️ Disclaimer

This is educational software. Use at your own risk. Always audit smart contracts before deploying to mainnet with real funds.
