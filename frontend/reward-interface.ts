import { Connection, PublicKey, Transaction, SystemProgram } from '@solana/web3.js';
import { Program, AnchorProvider, web3 } from '@coral-xyz/anchor';
import { IDL } from '../target/types/kamino_lending';

// Types matching the Rust contract
export enum RewardMode {
  RecurringInvestment = 'RecurringInvestment',
  RealTimeBatch = 'RealTimeBatch',
}

export enum RecurringFrequency {
  Daily = 'Daily',
  Weekly = 'Weekly',
  Monthly = 'Monthly',
}

export enum CompoundStrategy {
  Simple = 'Simple',
  Compound = 'Compound',
}

export enum BatchFrequency {
  Instant = 'Instant',
  Hourly = 'Hourly',
  Daily = 'Daily',
}

export enum UserTier {
  Diamond = 'Diamond',
  Gold = 'Gold',
  Silver = 'Silver',
  Bronze = 'Bronze',
}

export interface RewardPreferences {
  mode: RewardMode;
  reinvestmentPercentage: number; // 0-100
  compoundStrategy: CompoundStrategy;
  batchSize: number; // Minimum SOL for batch payout
  batchFrequency: BatchFrequency;
  payoutThreshold: number;
  autoCompound: boolean;
  lockDurationDays: number; // User-selected lock duration in days
}

export class RewardDistributionInterface {
  private program: Program;
  private connection: Connection;

  constructor(connection: Connection, wallet: any) {
    this.connection = connection;
    const provider = new AnchorProvider(connection, wallet, {});
    this.program = new Program(IDL, 'Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS', provider);
  }

  /**
   * Set user reward distribution preferences
   */
  async setRewardPreferences(
    userAccount: PublicKey,
    preferences: RewardPreferences
  ): Promise<string> {
    try {
      const tx = await this.program.methods
        .setRewardPreferences({
          mode: preferences.mode,
          reinvestmentPercentage: preferences.reinvestmentPercentage,
          compoundStrategy: preferences.compoundStrategy,
          batchSize: new web3.BN(preferences.batchSize),
          batchFrequency: preferences.batchFrequency,
          payoutThreshold: new web3.BN(preferences.payoutThreshold),
          autoCompound: preferences.autoCompound,
        })
        .accounts({
          userAccount,
          user: this.program.provider.publicKey!,
        })
        .rpc();

      return tx;
    } catch (error) {
      console.error('Error setting reward preferences:', error);
      throw error;
    }
  }

  /**
   * Distribute rewards based on user preferences
   */
  async distributeRewards(
    market: PublicKey,
    userAccount: PublicKey
  ): Promise<string> {
    try {
      const tx = await this.program.methods
        .distributeRewards()
        .accounts({
          market,
          userAccount,
          user: this.program.provider.publicKey!,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      return tx;
    } catch (error) {
      console.error('Error distributing rewards:', error);
      throw error;
    }
  }

  /**
   * Stake with immediate liquidity via JupSOL + Kamino multiply
   */
  async stakeWithImmediateLiquidity(
    market: PublicKey,
    userAccount: PublicKey,
    amount: number,
    lockDurationDays?: number,
    enableMultiply: boolean = false
  ): Promise<string> {
    try {
      const duration = lockDurationDays || 1; // Default to 1 day
      const tx = await this.program.methods
        .stakeWithImmediateLiquidity(
          new web3.BN(amount * 1e9), 
          duration,
          enableMultiply
        )
        .accounts({
          market,
          userAccount,
          user: this.program.provider.publicKey!,
          jupiterProgram: new PublicKey('JUP4Fb2cqiRUcaTHdrPC8h2gNsA2ETXiPDD33WcGuJB'), // Jupiter program
          kaminoProgram: new PublicKey('KMMSoLz1G1m9nar5CQSND4qPjLk7mdz9Gatf6JioHGi'), // Kamino program
          kaminoPosition: new PublicKey('11111111111111111111111111111111'), // Placeholder
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      return tx;
    } catch (error) {
      console.error('Error staking with immediate liquidity:', error);
      throw error;
    }
  }

  /**
   * Withdraw with immediate liquidity (JupSOL + Kamino unwinding)
   */
  async withdrawWithImmediateLiquidity(
    market: PublicKey,
    userAccount: PublicKey,
    permanentAccount: PublicKey
  ): Promise<string> {
    try {
      const tx = await this.program.methods
        .withdrawWithImmediateLiquidity()
        .accounts({
          market,
          userAccount,
          permanentAccount,
          user: this.program.provider.publicKey!,
          jupiterProgram: new PublicKey('JUP4Fb2cqiRUcaTHdrPC8h2gNsA2ETXiPDD33WcGuJB'), // Jupiter program
          kaminoProgram: new PublicKey('KMMSoLz1G1m9nar5CQSND4qPjLk7mdz9Gatf6JioHGi'), // Kamino program
          kaminoPosition: new PublicKey('11111111111111111111111111111111'), // Placeholder
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      return tx;
    } catch (error) {
      console.error('Error withdrawing with immediate liquidity:', error);
      throw error;
    }
  }

  /**
   * Withdraw stake (with early exit penalty if applicable)
   */
  async withdrawStake(
    market: PublicKey,
    userAccount: PublicKey,
    permanentAccount: PublicKey
  ): Promise<string> {
    try {
      const tx = await this.program.methods
        .withdrawStake()
        .accounts({
          market,
          userAccount,
          permanentAccount,
          user: this.program.provider.publicKey!,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      return tx;
    } catch (error) {
      console.error('Error withdrawing stake:', error);
      throw error;
    }
  }

  /**
   * Get user account data
   */
  async getUserAccount(userAccount: PublicKey) {
    try {
      const account = await this.program.account.userAccount.fetch(userAccount);
      return account;
    } catch (error) {
      console.error('Error fetching user account:', error);
      throw error;
    }
  }

  /**
   * Calculate estimated rewards for user
   */
  async calculateEstimatedRewards(userAccount: PublicKey): Promise<number> {
    try {
      const account = await this.getUserAccount(userAccount);
      const currentTime = Math.floor(Date.now() / 1000);
      const stakeDuration = currentTime - account.stakeStartTime.toNumber();
      
      // Base reward rate: 17% APY
      const baseRewardRate = 1700; // basis points
      const tierMultiplier = this.getTierMultiplier(account.tier);
      
      const rewards = account.stakeAmount
        .mul(new web3.BN(baseRewardRate))
        .mul(new web3.BN(stakeDuration))
        .mul(new web3.BN(tierMultiplier))
        .div(new web3.BN(365 * 24 * 60 * 60 * 10000)); // Convert to daily rate
      
      return rewards.toNumber() / 1e9; // Convert lamports to SOL
    } catch (error) {
      console.error('Error calculating estimated rewards:', error);
      throw error;
    }
  }

  /**
   * Get tier multiplier for reward calculation
   */
  private getTierMultiplier(tier: UserTier): number {
    switch (tier) {
      case UserTier.Diamond:
        return 150; // 1.5x multiplier
      case UserTier.Gold:
        return 125; // 1.25x multiplier
      case UserTier.Silver:
        return 100; // 1.0x multiplier
      case UserTier.Bronze:
        return 75; // 0.75x multiplier
      default:
        return 100;
    }
  }

  /**
   * Create recurring investment preferences
   */
  createRecurringPreferences(
    reinvestmentPercentage: number,
    compoundStrategy: CompoundStrategy,
    autoCompound: boolean = false
  ): RewardPreferences {
    return {
      mode: RewardMode.RecurringInvestment,
      reinvestmentPercentage,
      compoundStrategy,
      batchSize: 0,
      batchFrequency: BatchFrequency.Instant,
      payoutThreshold: 0,
      autoCompound,
    };
  }

  /**
   * Create real-time batch preferences
   */
  createBatchPreferences(
    batchSize: number,
    batchFrequency: BatchFrequency,
    payoutThreshold: number
  ): RewardPreferences {
    return {
      mode: RewardMode.RealTimeBatch,
      reinvestmentPercentage: 0,
      compoundStrategy: CompoundStrategy.Simple,
      batchSize,
      batchFrequency,
      payoutThreshold,
      autoCompound: false,
    };
  }
}

// Example usage
export const createRewardInterface = (connection: Connection, wallet: any) => {
  return new RewardDistributionInterface(connection, wallet);
};
