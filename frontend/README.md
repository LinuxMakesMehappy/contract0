# Reward Distribution Frontend

This frontend provides a user interface for the Flexible Tiered Yield Protocol (FTYP) reward distribution system.

## Architecture Overview

### **Smart Contract (Rust/Anchor)**
- **Location**: `src/lib.rs`
- **Purpose**: Core protocol logic, reward calculations, user preferences storage
- **Key Functions**:
  - `set_reward_preferences()` - Set user distribution preferences
  - `distribute_rewards()` - Execute reward distribution based on preferences
  - `calculate_current_rewards()` - Calculate user's current rewards

### **Frontend Interface (TypeScript)**
- **Location**: `frontend/reward-interface.ts`
- **Purpose**: TypeScript wrapper for smart contract interactions
- **Key Features**:
  - Type-safe contract interactions
  - Reward calculation utilities
  - Preference management helpers

### **React UI Component**
- **Location**: `frontend/RewardDistributionUI.tsx`
- **Purpose**: User interface for setting preferences and viewing rewards
- **Key Features**:
  - Real-time reward display
  - Preference configuration forms
  - Quick preset buttons
  - Transaction status feedback

## Reward Distribution Modes

### **1. Recurring Investment Mode**
Users can choose to automatically reinvest a percentage of their rewards:

```typescript
// Example: 80% reinvestment with compound strategy
const preferences = {
  mode: RewardMode.RecurringInvestment,
  reinvestmentPercentage: 80,
  compoundStrategy: CompoundStrategy.Compound,
  autoCompound: true
};
```

**Features:**
- **Reinvestment Percentage**: 0-100% of rewards reinvested
- **Compound Strategy**: 
  - `Simple`: Keep original lock period
  - `Compound`: Reset lock period for new compound
- **Auto-compound**: Automatically compound when threshold met

### **2. Real-Time Batch Mode**
Users can accumulate rewards and receive them in batches:

```typescript
// Example: 1 SOL minimum batch size, instant payout
const preferences = {
  mode: RewardMode.RealTimeBatch,
  batchSize: 1, // SOL
  batchFrequency: BatchFrequency.Instant,
  payoutThreshold: 0.1 // SOL
};
```

**Features:**
- **Batch Size**: Minimum SOL amount for payout
- **Batch Frequency**: Instant, Hourly, or Daily
- **Payout Threshold**: Minimum rewards to trigger payout

## Mathematical Expressions

### **Reward Calculation**
```rust
// Rust implementation in smart contract
let rewards = user_account.stake_amount
    .checked_mul(base_reward_rate as u64)      // 17% APY
    .checked_mul(stake_duration as u64)        // Time staked
    .checked_mul(tier_multiplier as u64)       // Tier bonus
    .checked_div(365 * 24 * 60 * 60 * 10000);  // Daily rate conversion
```

### **Tier Multipliers**
- **Diamond**: 1.5x multiplier (150%)
- **Gold**: 1.25x multiplier (125%)
- **Silver**: 1.0x multiplier (100%)
- **Bronze**: 0.75x multiplier (75%)

### **Reinvestment Formula**
```typescript
// TypeScript calculation
const reinvestmentAmount = rewards * reinvestmentPercentage / 100;
const payoutAmount = rewards - reinvestmentAmount;
```

## Usage Examples

### **Setting Recurring Investment Preferences**
```typescript
import { RewardDistributionInterface, RewardMode, CompoundStrategy } from './reward-interface';

const interface = new RewardDistributionInterface(connection, wallet);

// Set 100% compound reinvestment
const preferences = interface.createRecurringPreferences(
  100, // 100% reinvestment
  CompoundStrategy.Compound,
  true // auto-compound
);

await interface.setRewardPreferences(userAccount, preferences);
```

### **Setting Batch Preferences**
```typescript
// Set 1 SOL batch size with instant payout
const preferences = interface.createBatchPreferences(
  1, // 1 SOL batch size
  BatchFrequency.Instant,
  0.1 // 0.1 SOL threshold
);

await interface.setRewardPreferences(userAccount, preferences);
```

### **Distributing Rewards**
```typescript
// Distribute rewards based on user preferences
const tx = await interface.distributeRewards(market, userAccount);
console.log('Rewards distributed:', tx);
```

## Quick Presets

The UI provides three quick preset configurations:

### **1. Max Compound (100% reinvest)**
- Mode: Recurring Investment
- Reinvestment: 100%
- Strategy: Compound
- Auto-compound: Enabled

### **2. Balanced (50% reinvest)**
- Mode: Recurring Investment
- Reinvestment: 50%
- Strategy: Simple
- Auto-compound: Disabled

### **3. Real-time (1 SOL batches)**
- Mode: Real-time Batch
- Batch size: 1 SOL
- Frequency: Instant
- Threshold: 0.1 SOL

## Installation & Setup

### **Prerequisites**
```bash
npm install @solana/web3.js @coral-xyz/anchor @solana/wallet-adapter-react
```

### **Environment Variables**
```env
REACT_APP_SOLANA_RPC_URL=https://api.mainnet-beta.solana.com
REACT_APP_PROGRAM_ID=Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS
```

### **Integration**
```typescript
import { RewardDistributionUI } from './RewardDistributionUI';

function App() {
  return (
    <RewardDistributionUI
      connection={connection}
      marketAddress="your_market_address"
      userAccountAddress="user_account_address"
    />
  );
}
```

## Benefits

### **For Users:**
- ✅ **Flexibility**: Choose reward distribution style
- ✅ **Optimization**: Gas-efficient batching
- ✅ **Growth**: Compound reinvestment options
- ✅ **Liquidity**: Real-time access to rewards

### **For Protocol:**
- ✅ **Efficiency**: Batch processing reduces gas costs
- ✅ **Retention**: Recurring investment keeps users engaged
- ✅ **Scalability**: Handles different user preferences
- ✅ **Analytics**: Better tracking of user behavior

## Security Considerations

1. **Input Validation**: All user inputs are validated on both frontend and smart contract
2. **Overflow Protection**: Rust contract uses checked arithmetic operations
3. **Access Control**: Only authorized users can modify their preferences
4. **Gas Optimization**: Batch operations reduce transaction costs

## Future Enhancements

1. **Advanced Analytics**: Detailed reward tracking and performance metrics
2. **Social Features**: Share strategies and compare with other users
3. **Automation**: Scheduled reward distribution and rebalancing
4. **Mobile App**: Native mobile interface for on-the-go management
