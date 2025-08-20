#!/usr/bin/env ts-node

import { Connection, Keypair, PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { Program, AnchorProvider, web3, BN } from '@coral-xyz/anchor';
import { IDL } from '../target/types/kamino_lending';
import * as fs from 'fs';
import * as path from 'path';

// Configuration
const PROGRAM_ID = 'Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS';
const RPC_URL = process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';

interface StakeOptions {
  amount: number;
  duration?: number; // Optional, defaults to 1 day
  marketAddress: string;
  userAccountAddress?: string;
  permanentAccountAddress: string;
  enableMultiply?: boolean; // Enable Kamino multiply
  immediateLiquidity?: boolean; // Enable immediate liquidity
}

class StakingCLI {
  private connection: Connection;
  private program: Program;
  private wallet: Keypair;

  constructor() {
    this.connection = new Connection(RPC_URL, 'confirmed');
    this.wallet = this.loadWallet();
    
    const provider = new AnchorProvider(
      this.connection,
      { publicKey: this.wallet.publicKey, signTransaction: (tx) => Promise.resolve(tx) },
      { commitment: 'confirmed' }
    );
    
    this.program = new Program(IDL, PROGRAM_ID, provider);
  }

  private loadWallet(): Keypair {
    const walletPath = process.env.SOLANA_WALLET_PATH || path.join(process.env.HOME || '', '.config/solana/id.json');
    
    if (!fs.existsSync(walletPath)) {
      throw new Error(`Wallet file not found at ${walletPath}. Please set SOLANA_WALLET_PATH or use default location.`);
    }
    
    const walletData = JSON.parse(fs.readFileSync(walletPath, 'utf-8'));
    return Keypair.fromSecretKey(new Uint8Array(walletData));
  }

  async stake(options: StakeOptions): Promise<string> {
    try {
      const duration = options.duration || 1; // Default to 1 day
      const enableMultiply = options.enableMultiply || false;
      const immediateLiquidity = options.immediateLiquidity !== false; // Default to true
      
      console.log(`Staking ${options.amount} SOL for ${duration} days...`);
      if (immediateLiquidity) {
        console.log(`🔄 Immediate liquidity enabled (JupSOL + Kamino)`);
        if (enableMultiply) {
          console.log(`🚀 Kamino multiply enabled (max leverage)`);
        }
      }
      
      const marketPubkey = new PublicKey(options.marketAddress);
      const userAccountPubkey = new PublicKey(options.userAccountAddress || this.getUserAccountAddress());
      
      if (immediateLiquidity) {
        const tx = await this.program.methods
          .stakeWithImmediateLiquidity(
            new BN(options.amount * LAMPORTS_PER_SOL),
            duration,
            enableMultiply
          )
          .accounts({
            market: marketPubkey,
            userAccount: userAccountPubkey,
            user: this.wallet.publicKey,
            jupiterProgram: new PublicKey('JUP4Fb2cqiRUcaTHdrPC8h2gNsA2ETXiPDD33WcGuJB'),
            kaminoProgram: new PublicKey('KMMSoLz1G1m9nar5CQSND4qPjLk7mdz9Gatf6JioHGi'),
            kaminoPosition: new PublicKey('11111111111111111111111111111111'), // Placeholder
            systemProgram: web3.SystemProgram.programId,
          })
          .rpc();

        console.log(`✅ Stake with immediate liquidity successful! Transaction: ${tx}`);
        return tx;
      } else {
        const tx = await this.program.methods
          .stakeWithDuration(
            new BN(options.amount * LAMPORTS_PER_SOL),
            duration
          )
          .accounts({
            market: marketPubkey,
            userAccount: userAccountPubkey,
            user: this.wallet.publicKey,
            systemProgram: web3.SystemProgram.programId,
          })
          .rpc();

        console.log(`✅ Stake successful! Transaction: ${tx}`);
        return tx;
      }
    } catch (error) {
      console.error('❌ Error staking:', error);
      throw error;
    }
  }

  async withdraw(options: { marketAddress: string; userAccountAddress?: string; permanentAccountAddress: string }): Promise<string> {
    try {
      console.log('Withdrawing stake...');
      
      const marketPubkey = new PublicKey(options.marketAddress);
      const userAccountPubkey = new PublicKey(options.userAccountAddress || this.getUserAccountAddress());
      const permanentAccountPubkey = new PublicKey(options.permanentAccountAddress);
      
      const tx = await this.program.methods
        .withdrawStake()
        .accounts({
          market: marketPubkey,
          userAccount: userAccountPubkey,
          permanentAccount: permanentAccountPubkey,
          user: this.wallet.publicKey,
          systemProgram: web3.SystemProgram.programId,
        })
        .rpc();

      console.log(`✅ Withdrawal successful! Transaction: ${tx}`);
      return tx;
    } catch (error) {
      console.error('❌ Error withdrawing:', error);
      throw error;
    }
  }

  async getStakeInfo(userAccountAddress?: string): Promise<any> {
    try {
      const userAccountPubkey = new PublicKey(userAccountAddress || this.getUserAccountAddress());
      const account = await this.program.account.userAccount.fetch(userAccountPubkey);
      
      const currentTime = Math.floor(Date.now() / 1000);
      const isEarlyExit = currentTime < account.intendedEndTime.toNumber();
      const timeRemaining = Math.max(0, account.intendedEndTime.toNumber() - currentTime);
      
      return {
        stakeAmount: account.stakeAmount.toNumber() / LAMPORTS_PER_SOL,
        lockDurationDays: account.lockDurationDays,
        startTime: new Date(account.stakeStartTime.toNumber() * 1000),
        endTime: new Date(account.intendedEndTime.toNumber() * 1000),
        timeRemainingDays: Math.ceil(timeRemaining / (24 * 60 * 60)),
        isEarlyExit,
        tier: account.tier,
        totalRewardsReceived: account.totalRewardsReceived.toNumber() / LAMPORTS_PER_SOL,
      };
    } catch (error) {
      console.error('❌ Error fetching stake info:', error);
      throw error;
    }
  }

  async setRewardPreferences(options: {
    userAccountAddress?: string;
    mode: 'recurring' | 'batch';
    reinvestmentPercentage?: number;
    batchSize?: number;
    lockDurationDays: number;
  }): Promise<string> {
    try {
      console.log('Setting reward preferences...');
      
      const userAccountPubkey = new PublicKey(options.userAccountAddress || this.getUserAccountAddress());
      
      const preferences = {
        mode: options.mode === 'recurring' ? { RecurringInvestment: {} } : { RealTimeBatch: {} },
        reinvestmentPercentage: options.reinvestmentPercentage || 80,
        compoundStrategy: { Compound: {} },
        batchSize: new BN(options.batchSize || 0),
        batchFrequency: { Instant: {} },
        payoutThreshold: new BN(0),
        autoCompound: false,
        lockDurationDays: options.lockDurationDays,
      };
      
      const tx = await this.program.methods
        .setRewardPreferences(preferences)
        .accounts({
          userAccount: userAccountPubkey,
          user: this.wallet.publicKey,
        })
        .rpc();

      console.log(`✅ Preferences set successfully! Transaction: ${tx}`);
      return tx;
    } catch (error) {
      console.error('❌ Error setting preferences:', error);
      throw error;
    }
  }

  private getUserAccountAddress(): string {
    const [userAccountPubkey] = PublicKey.findProgramAddressSync(
      [Buffer.from('user_account'), this.wallet.publicKey.toBuffer()],
      new PublicKey(PROGRAM_ID)
    );
    return userAccountPubkey.toString();
  }

  async showHelp(): Promise<void> {
    console.log(`
🔧 Flexible Staking CLI

Usage:
  ts-node stake-cli.ts <command> [options]

Commands:
  stake <amount> [duration] <market-address> [permanent-account-address] [--multiply] [--no-liquidity]
    Stake SOL with immediate liquidity via JupSOL + Kamino (defaults to 1 day if duration not specified)
    --multiply: Enable Kamino multiply for max leverage
    --no-liquidity: Disable immediate liquidity (use regular staking)
    
  withdraw <market-address> [permanent-account-address]
    Withdraw stake (with early exit penalty if applicable)
    
  info [user-account-address]
    Show current stake information
    
  preferences <mode> <lock-duration> [options]
    Set reward distribution preferences
    
  help
    Show this help message

Examples:
  # Stake 10 SOL for 1 day with immediate liquidity (default)
  ts-node stake-cli.ts stake 10 Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS
  
  # Stake 10 SOL for 30 days with Kamino multiply
  ts-node stake-cli.ts stake 10 30 Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS --multiply
  
  # Stake 10 SOL for 30 days without immediate liquidity
  ts-node stake-cli.ts stake 10 30 Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS --no-liquidity
  
  # Withdraw stake
  ts-node stake-cli.ts withdraw Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS
  
  # Show stake info
  ts-node stake-cli.ts info
  
  # Set recurring investment preferences
  ts-node stake-cli.ts preferences recurring 30 --reinvestment 80

Environment Variables:
  SOLANA_RPC_URL          Solana RPC endpoint (default: mainnet-beta)
  SOLANA_WALLET_PATH      Path to wallet keypair file
    `);
  }
}

// CLI Entry Point
async function main() {
  const cli = new StakingCLI();
  const args = process.argv.slice(2);
  const command = args[0];

  try {
    switch (command) {
      case 'stake':
        if (args.length < 3) {
          console.error('❌ Usage: stake <amount> [duration] <market-address>');
          process.exit(1);
        }
        // Parse flags
        const enableMultiply = args.includes('--multiply');
        const noLiquidity = args.includes('--no-liquidity');
        
        await cli.stake({
          amount: parseFloat(args[1]),
          duration: args[2] && !isNaN(parseInt(args[2])) ? parseInt(args[2]) : undefined, // Optional duration
          marketAddress: args[2] && !isNaN(parseInt(args[2])) ? args[3] : args[2], // Adjust market address based on whether duration was provided
          permanentAccountAddress: (args[2] && !isNaN(parseInt(args[2])) ? args[4] : args[3]) || 'Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS',
          enableMultiply,
          immediateLiquidity: !noLiquidity, // Default to true unless --no-liquidity is specified
        });
        break;

      case 'withdraw':
        if (args.length < 2) {
          console.error('❌ Usage: withdraw <market-address>');
          process.exit(1);
        }
        await cli.withdraw({
          marketAddress: args[1],
          permanentAccountAddress: args[2] || 'Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS',
        });
        break;

      case 'info':
        const info = await cli.getStakeInfo(args[1]);
        console.log('\n📊 Stake Information:');
        console.log(`Stake Amount: ${info.stakeAmount} SOL`);
        console.log(`Lock Duration: ${info.lockDurationDays} days`);
        console.log(`Start Time: ${info.startTime}`);
        console.log(`End Time: ${info.endTime}`);
        console.log(`Time Remaining: ${info.timeRemainingDays} days`);
        console.log(`Early Exit: ${info.isEarlyExit ? 'Yes' : 'No'}`);
        console.log(`User Tier: ${info.tier}`);
        console.log(`Total Rewards: ${info.totalRewardsReceived} SOL`);
        break;

      case 'preferences':
        if (args.length < 3) {
          console.error('❌ Usage: preferences <mode> <lock-duration>');
          process.exit(1);
        }
        await cli.setRewardPreferences({
          mode: args[1] as 'recurring' | 'batch',
          lockDurationDays: parseInt(args[2]),
          reinvestmentPercentage: args.includes('--reinvestment') ? 
            parseInt(args[args.indexOf('--reinvestment') + 1]) : 80,
          batchSize: args.includes('--batch-size') ? 
            parseInt(args[args.indexOf('--batch-size') + 1]) : 1,
        });
        break;

      case 'help':
      default:
        await cli.showHelp();
        break;
    }
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

// Run CLI if called directly
if (require.main === module) {
  main();
}

export { StakingCLI };
