use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer, Mint};
use anchor_spl::associated_token::AssociatedToken;
use spl_math::precise_number::PreciseNumber;

// JupSOL and Kamino integration constants
const JUPITER_SOL_MINT: &str = "J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn"; // JupSOL mint address
const KAMINO_MULTIPLY_PROGRAM: &str = "KMMSoLz1G1m9nar5CQSND4qPjLk7mdz9Gatf6JioHGi"; // Kamino multiply program

declare_id!("Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS");

// Reward distribution modes
#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq)]
pub enum RewardMode {
    RecurringInvestment,
    RealTimeBatch,
}

// Recurring investment frequency
#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq)]
pub enum RecurringFrequency {
    Daily,
    Weekly,
    Monthly,
}

// Compound strategy
#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq)]
pub enum CompoundStrategy {
    Simple,
    Compound,
}

// Batch frequency
#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq)]
pub enum BatchFrequency {
    Instant,
    Hourly,
    Daily,
}

// User tiers
#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq)]
pub enum UserTier {
    Diamond,
    Gold,
    Silver,
    Bronze,
}

// User reward preferences
#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct RewardPreferences {
    pub mode: RewardMode,
    pub reinvestment_percentage: u8, // 0-100
    pub compound_strategy: CompoundStrategy,
    pub batch_size: u64, // Minimum SOL for batch payout
    pub batch_frequency: BatchFrequency,
    pub payout_threshold: u64,
    pub auto_compound: bool,
    pub lock_duration_days: u32, // User-selected lock duration in days
}

#[program]
pub mod kamino_lending {
    use super::*;

    /// Initialize the lending market
    pub fn initialize_market(
        ctx: Context<InitializeMarket>,
        market_bump: u8,
    ) -> Result<()> {
        let market = &mut ctx.accounts.market;
        market.authority = ctx.accounts.authority.key();
        market.bump = market_bump;
        market.total_deposits = 0;
        market.total_borrows = 0;
        market.reserve_factor = 1000; // 10% in basis points
        market.interest_rate_model = InterestRateModel {
            base_rate: 500, // 5% base rate
            multiplier: 2000, // 20% multiplier
            jump_multiplier: 5000, // 50% jump multiplier
            kink: 8000, // 80% utilization kink
        };
        Ok(())
    }

    /// Add a new reserve to the market
    pub fn add_reserve(
        ctx: Context<AddReserve>,
        reserve_bump: u8,
        ltv_ratio: u16,
        liquidation_threshold: u16,
        liquidation_penalty: u16,
    ) -> Result<()> {
        let reserve = &mut ctx.accounts.reserve;
        reserve.market = ctx.accounts.market.key();
        reserve.mint = ctx.accounts.mint.key();
        reserve.ltv_ratio = ltv_ratio;
        reserve.liquidation_threshold = liquidation_threshold;
        reserve.liquidation_penalty = liquidation_penalty;
        reserve.bump = reserve_bump;
        reserve.total_deposits = 0;
        reserve.total_borrows = 0;
        reserve.deposit_index = 1_000_000_000; // 1.0 in scaled form
        reserve.borrow_index = 1_000_000_000;
        reserve.last_update = Clock::get()?.slot;
        Ok(())
    }

    /// Deposit tokens into a reserve
    pub fn deposit(
        ctx: Context<Deposit>,
        amount: u64,
    ) -> Result<()> {
        let reserve = &mut ctx.accounts.reserve;
        let user_account = &mut ctx.accounts.user_account;
        
        // Transfer tokens from user to reserve
        let transfer_ctx = CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.user_token_account.to_account_info(),
                to: ctx.accounts.reserve_token_account.to_account_info(),
                authority: ctx.accounts.user.to_account_info(),
            },
        );
        token::transfer(transfer_ctx, amount)?;

        // Update user's deposit balance
        let user_deposit = user_account.deposits.iter_mut()
            .find(|d| d.reserve == reserve.key())
            .unwrap_or_else(|| {
                user_account.deposits.push(UserDeposit {
                    reserve: reserve.key(),
                    amount: 0,
                    deposit_index: reserve.deposit_index,
                });
                user_account.deposits.last_mut().unwrap()
            });

        // Accrue interest before updating
        let current_deposit_index = reserve.deposit_index;
        let user_deposit_index = user_deposit.deposit_index;
        
        if current_deposit_index > user_deposit_index {
            let interest_earned = (user_deposit.amount as u128)
                .checked_mul(current_deposit_index as u128)
                .unwrap()
                .checked_div(user_deposit_index as u128)
                .unwrap()
                .checked_sub(user_deposit.amount as u128)
                .unwrap();
            user_deposit.amount = user_deposit.amount.checked_add(interest_earned as u64).unwrap();
        }

        user_deposit.amount = user_deposit.amount.checked_add(amount).unwrap();
        user_deposit.deposit_index = current_deposit_index;

        // Update reserve totals
        reserve.total_deposits = reserve.total_deposits.checked_add(amount).unwrap();
        reserve.last_update = Clock::get()?.slot;

        // Update market totals
        let market = &mut ctx.accounts.market;
        market.total_deposits = market.total_deposits.checked_add(amount).unwrap();

        Ok(())
    }

    /// Borrow tokens from a reserve
    pub fn borrow(
        ctx: Context<Borrow>,
        amount: u64,
    ) -> Result<()> {
        let reserve = &mut ctx.accounts.reserve;
        let user_account = &mut ctx.accounts.user_account;
        
        // Check if user has sufficient collateral
        let borrow_limit = calculate_borrow_limit(user_account, &ctx.accounts.market)?;
        let current_borrow = calculate_total_borrow(user_account, &ctx.accounts.market)?;
        
        require!(
            current_borrow.checked_add(amount).unwrap() <= borrow_limit,
            LendingError::InsufficientCollateral
        );

        // Check if reserve has sufficient liquidity
        require!(
            amount <= reserve.total_deposits.checked_sub(reserve.total_borrows).unwrap(),
            LendingError::InsufficientLiquidity
        );

        // Transfer tokens from reserve to user
        let transfer_ctx = CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.reserve_token_account.to_account_info(),
                to: ctx.accounts.user_token_account.to_account_info(),
                authority: ctx.accounts.market.to_account_info(),
            },
        );
        token::transfer(transfer_ctx, amount)?;

        // Update user's borrow balance
        let user_borrow = user_account.borrows.iter_mut()
            .find(|b| b.reserve == reserve.key())
            .unwrap_or_else(|| {
                user_account.borrows.push(UserBorrow {
                    reserve: reserve.key(),
                    amount: 0,
                    borrow_index: reserve.borrow_index,
                });
                user_account.borrows.last_mut().unwrap()
            });

        // Accrue interest before updating
        let current_borrow_index = reserve.borrow_index;
        let user_borrow_index = user_borrow.borrow_index;
        
        if current_borrow_index > user_borrow_index {
            let interest_owed = (user_borrow.amount as u128)
                .checked_mul(current_borrow_index as u128)
                .unwrap()
                .checked_div(user_borrow_index as u128)
                .unwrap()
                .checked_sub(user_borrow.amount as u128)
                .unwrap();
            user_borrow.amount = user_borrow.amount.checked_add(interest_owed as u64).unwrap();
        }

        user_borrow.amount = user_borrow.amount.checked_add(amount).unwrap();
        user_borrow.borrow_index = current_borrow_index;

        // Update reserve totals
        reserve.total_borrows = reserve.total_borrows.checked_add(amount).unwrap();
        reserve.last_update = Clock::get()?.slot;

        // Update market totals
        let market = &mut ctx.accounts.market;
        market.total_borrows = market.total_borrows.checked_add(amount).unwrap();

        Ok(())
    }

    /// Repay borrowed tokens
    pub fn repay(
        ctx: Context<Repay>,
        amount: u64,
    ) -> Result<()> {
        let reserve = &mut ctx.accounts.reserve;
        let user_account = &mut ctx.accounts.user_account;
        
        // Find user's borrow for this reserve
        let user_borrow = user_account.borrows.iter_mut()
            .find(|b| b.reserve == reserve.key())
            .ok_or(LendingError::NoBorrowFound)?;

        // Accrue interest
        let current_borrow_index = reserve.borrow_index;
        let user_borrow_index = user_borrow.borrow_index;
        
        if current_borrow_index > user_borrow_index {
            let interest_owed = (user_borrow.amount as u128)
                .checked_mul(current_borrow_index as u128)
                .unwrap()
                .checked_div(user_borrow_index as u128)
                .unwrap()
                .checked_sub(user_borrow.amount as u128)
                .unwrap();
            user_borrow.amount = user_borrow.amount.checked_add(interest_owed as u64).unwrap();
        }

        let repay_amount = std::cmp::min(amount, user_borrow.amount);

        // Transfer tokens from user to reserve
        let transfer_ctx = CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.user_token_account.to_account_info(),
                to: ctx.accounts.reserve_token_account.to_account_info(),
                authority: ctx.accounts.user.to_account_info(),
            },
        );
        token::transfer(transfer_ctx, repay_amount)?;

        // Update user's borrow balance
        user_borrow.amount = user_borrow.amount.checked_sub(repay_amount).unwrap();
        user_borrow.borrow_index = current_borrow_index;

        // Update reserve totals
        reserve.total_borrows = reserve.total_borrows.checked_sub(repay_amount).unwrap();
        reserve.last_update = Clock::get()?.slot;

        // Update market totals
        let market = &mut ctx.accounts.market;
        market.total_borrows = market.total_borrows.checked_sub(repay_amount).unwrap();

        Ok(())
    }

    /// Withdraw deposited tokens
    pub fn withdraw(
        ctx: Context<Withdraw>,
        amount: u64,
    ) -> Result<()> {
        let reserve = &mut ctx.accounts.reserve;
        let user_account = &mut ctx.accounts.user_account;
        
        // Find user's deposit for this reserve
        let user_deposit = user_account.deposits.iter_mut()
            .find(|d| d.reserve == reserve.key())
            .ok_or(LendingError::NoDepositFound)?;

        // Accrue interest
        let current_deposit_index = reserve.deposit_index;
        let user_deposit_index = user_deposit.deposit_index;
        
        if current_deposit_index > user_deposit_index {
            let interest_earned = (user_deposit.amount as u128)
                .checked_mul(current_deposit_index as u128)
                .unwrap()
                .checked_div(user_deposit_index as u128)
                .unwrap()
                .checked_sub(user_deposit.amount as u128)
                .unwrap();
            user_deposit.amount = user_deposit.amount.checked_add(interest_earned as u64).unwrap();
        }

        require!(
            amount <= user_deposit.amount,
            LendingError::InsufficientBalance
        );

        // Check if withdrawal would make user undercollateralized
        let borrow_limit = calculate_borrow_limit(user_account, &ctx.accounts.market)?;
        let current_borrow = calculate_total_borrow(user_account, &ctx.accounts.market)?;
        
        // Calculate new deposit amount after withdrawal
        let new_deposit_amount = user_deposit.amount.checked_sub(amount).unwrap();
        let temp_user_account = UserAccount {
            deposits: user_account.deposits.clone(),
            borrows: user_account.borrows.clone(),
            ..Default::default()
        };
        
        // Update the deposit amount temporarily for calculation
        if let Some(deposit) = temp_user_account.deposits.iter_mut().find(|d| d.reserve == reserve.key()) {
            deposit.amount = new_deposit_amount;
        }
        
        let new_borrow_limit = calculate_borrow_limit(&temp_user_account, &ctx.accounts.market)?;
        require!(
            current_borrow <= new_borrow_limit,
            LendingError::InsufficientCollateral
        );

        // Transfer tokens from reserve to user
        let transfer_ctx = CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.reserve_token_account.to_account_info(),
                to: ctx.accounts.user_token_account.to_account_info(),
                authority: ctx.accounts.market.to_account_info(),
            },
        );
        token::transfer(transfer_ctx, amount)?;

        // Update user's deposit balance
        user_deposit.amount = new_deposit_amount;
        user_deposit.deposit_index = current_deposit_index;

        // Update reserve totals
        reserve.total_deposits = reserve.total_deposits.checked_sub(amount).unwrap();
        reserve.last_update = Clock::get()?.slot;

        // Update market totals
        let market = &mut ctx.accounts.market;
        market.total_deposits = market.total_deposits.checked_sub(amount).unwrap();

        Ok(())
    }

    /// Liquidate an undercollateralized position
    pub fn liquidate(
        ctx: Context<Liquidate>,
        amount: u64,
    ) -> Result<()> {
        let liquidated_user = &mut ctx.accounts.liquidated_user_account;
        let liquidator_user = &mut ctx.accounts.liquidator_user_account;
        let reserve = &mut ctx.accounts.reserve;
        
        // Check if position is actually undercollateralized
        let borrow_limit = calculate_borrow_limit(liquidated_user, &ctx.accounts.market)?;
        let current_borrow = calculate_total_borrow(liquidated_user, &ctx.accounts.market)?;
        
        require!(
            current_borrow > borrow_limit,
            LendingError::PositionNotLiquidatable
        );

        // Find the borrow to liquidate
        let user_borrow = liquidated_user.borrows.iter_mut()
            .find(|b| b.reserve == reserve.key())
            .ok_or(LendingError::NoBorrowFound)?;

        let liquidate_amount = std::cmp::min(amount, user_borrow.amount);

        // Calculate liquidation bonus
        let liquidation_bonus = (liquidate_amount as u128)
            .checked_mul(reserve.liquidation_penalty as u128)
            .unwrap()
            .checked_div(10000)
            .unwrap() as u64;

        let total_liquidate_amount = liquidate_amount.checked_add(liquidation_bonus).unwrap();

        // Transfer tokens from liquidator to reserve
        let transfer_ctx = CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.liquidator_token_account.to_account_info(),
                to: ctx.accounts.reserve_token_account.to_account_info(),
                authority: ctx.accounts.liquidator.to_account_info(),
            },
        );
        token::transfer(transfer_ctx, liquidate_amount)?;

        // Transfer liquidation bonus to liquidator
        let bonus_transfer_ctx = CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.reserve_token_account.to_account_info(),
                to: ctx.accounts.liquidator_token_account.to_account_info(),
                authority: ctx.accounts.market.to_account_info(),
            },
        );
        token::transfer(bonus_transfer_ctx, liquidation_bonus)?;

        // Update liquidated user's borrow
        user_borrow.amount = user_borrow.amount.checked_sub(liquidate_amount).unwrap();

        // Update reserve totals
        reserve.total_borrows = reserve.total_borrows.checked_sub(liquidate_amount).unwrap();

        // Update market totals
        let market = &mut ctx.accounts.market;
        market.total_borrows = market.total_borrows.checked_sub(liquidate_amount).unwrap();

        Ok(())
    }

    /// Flash loan functionality for multiply strategies
    pub fn flash_loan(
        ctx: Context<FlashLoan>,
        amount: u64,
        fee: u64,
    ) -> Result<()> {
        let reserve = &mut ctx.accounts.reserve;
        
        // Transfer tokens to borrower
        let transfer_ctx = CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.reserve_token_account.to_account_info(),
                to: ctx.accounts.borrower_token_account.to_account_info(),
                authority: ctx.accounts.market.to_account_info(),
            },
        );
        token::transfer(transfer_ctx, amount)?;

        // The borrower should execute their logic here (swap, deposit, etc.)
        // This would typically be done through CPI calls or by the borrower

        // Transfer back the borrowed amount plus fee
        let repay_amount = amount.checked_add(fee).unwrap();
        let repay_ctx = CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.borrower_token_account.to_account_info(),
                to: ctx.accounts.reserve_token_account.to_account_info(),
                authority: ctx.accounts.borrower.to_account_info(),
            },
        );
        token::transfer(repay_ctx, repay_amount)?;

        // Update reserve with fee
        reserve.total_deposits = reserve.total_deposits.checked_add(fee).unwrap();

        Ok(())
    }

    /// Deposit native SOL into the market
    pub fn deposit_sol(
        ctx: Context<DepositSol>,
        amount: u64,
    ) -> Result<()> {
        let market = &mut ctx.accounts.market;
        let user_account = &mut ctx.accounts.user_account;
        
        // Transfer SOL from user to market
        let transfer_ctx = CpiContext::new(
            ctx.accounts.system_program.to_account_info(),
            anchor_lang::system_program::Transfer {
                from: ctx.accounts.user.to_account_info(),
                to: ctx.accounts.market.to_account_info(),
            },
        );
        anchor_lang::system_program::transfer(transfer_ctx, amount)?;

        // Update user's SOL deposit balance
        let user_deposit = user_account.deposits.iter_mut()
            .find(|d| d.reserve == ctx.accounts.sol_reserve.key())
            .unwrap_or_else(|| {
                user_account.deposits.push(UserDeposit {
                    reserve: ctx.accounts.sol_reserve.key(),
                    amount: 0,
                    deposit_index: ctx.accounts.sol_reserve.deposit_index,
                });
                user_account.deposits.last_mut().unwrap()
            });

        // Accrue interest before updating
        let current_deposit_index = ctx.accounts.sol_reserve.deposit_index;
        let user_deposit_index = user_deposit.deposit_index;
        
        if current_deposit_index > user_deposit_index {
            let interest_earned = (user_deposit.amount as u128)
                .checked_mul(current_deposit_index as u128)
                .unwrap()
                .checked_div(user_deposit_index as u128)
                .unwrap()
                .checked_sub(user_deposit.amount as u128)
                .unwrap();
            user_deposit.amount = user_deposit.amount.checked_add(interest_earned as u64).unwrap();
        }

        user_deposit.amount = user_deposit.amount.checked_add(amount).unwrap();
        user_deposit.deposit_index = current_deposit_index;

        // Update SOL reserve totals
        let sol_reserve = &mut ctx.accounts.sol_reserve;
        sol_reserve.total_deposits = sol_reserve.total_deposits.checked_add(amount).unwrap();
        sol_reserve.last_update = Clock::get()?.slot;

        // Update market totals
        market.total_deposits = market.total_deposits.checked_add(amount).unwrap();

        Ok(())
    }

    /// Withdraw native SOL from the market
    pub fn withdraw_sol(
        ctx: Context<WithdrawSol>,
        amount: u64,
    ) -> Result<()> {
        let market = &mut ctx.accounts.market;
        let user_account = &mut ctx.accounts.user_account;
        let sol_reserve = &mut ctx.accounts.sol_reserve;
        
        // Find user's SOL deposit
        let user_deposit = user_account.deposits.iter_mut()
            .find(|d| d.reserve == sol_reserve.key())
            .ok_or(LendingError::NoDepositFound)?;

        // Accrue interest
        let current_deposit_index = sol_reserve.deposit_index;
        let user_deposit_index = user_deposit.deposit_index;
        
        if current_deposit_index > user_deposit_index {
            let interest_earned = (user_deposit.amount as u128)
                .checked_mul(current_deposit_index as u128)
                .unwrap()
                .checked_div(user_deposit_index as u128)
                .unwrap()
                .checked_sub(user_deposit.amount as u128)
                .unwrap();
            user_deposit.amount = user_deposit.amount.checked_add(interest_earned as u64).unwrap();
        }

        require!(
            amount <= user_deposit.amount,
            LendingError::InsufficientBalance
        );

        // Check if withdrawal would make user undercollateralized
        let borrow_limit = calculate_borrow_limit(user_account, market)?;
        let current_borrow = calculate_total_borrow(user_account, market)?;
        
        let new_deposit_amount = user_deposit.amount.checked_sub(amount).unwrap();
        let temp_user_account = UserAccount {
            deposits: user_account.deposits.clone(),
            borrows: user_account.borrows.clone(),
            ..Default::default()
        };
        
        if let Some(deposit) = temp_user_account.deposits.iter_mut().find(|d| d.reserve == sol_reserve.key()) {
            deposit.amount = new_deposit_amount;
        }
        
        let new_borrow_limit = calculate_borrow_limit(&temp_user_account, market)?;
        require!(
            current_borrow <= new_borrow_limit,
            LendingError::InsufficientCollateral
        );

        // Transfer SOL from market to user
        let transfer_ctx = CpiContext::new(
            ctx.accounts.system_program.to_account_info(),
            anchor_lang::system_program::Transfer {
                from: ctx.accounts.market.to_account_info(),
                to: ctx.accounts.user.to_account_info(),
            },
        );
        anchor_lang::system_program::transfer(transfer_ctx, amount)?;

        // Update user's deposit balance
        user_deposit.amount = new_deposit_amount;
        user_deposit.deposit_index = current_deposit_index;

        // Update SOL reserve totals
        sol_reserve.total_deposits = sol_reserve.total_deposits.checked_sub(amount).unwrap();
        sol_reserve.last_update = Clock::get()?.slot;

        // Update market totals
        market.total_deposits = market.total_deposits.checked_sub(amount).unwrap();

        Ok(())
    }
}

// Helper functions
fn calculate_borrow_limit(user_account: &UserAccount, market: &Market) -> Result<u64> {
    let mut total_collateral_value = 0u64;
    
    for deposit in &user_account.deposits {
        // In a real implementation, you'd get the reserve and calculate value
        // For simplicity, we'll assume 1:1 value ratio
        total_collateral_value = total_collateral_value.checked_add(deposit.amount).unwrap();
    }
    
    // Apply LTV ratio (simplified - in reality would be per-reserve)
    let borrow_limit = (total_collateral_value as u128)
        .checked_mul(7500) // 75% LTV
        .unwrap()
        .checked_div(10000)
        .unwrap() as u64;
    
    Ok(borrow_limit)
}

fn calculate_total_borrow(user_account: &UserAccount, market: &Market) -> Result<u64> {
    let mut total_borrow = 0u64;
    
    for borrow in &user_account.borrows {
        // In a real implementation, you'd get the reserve and calculate value
        // For simplicity, we'll assume 1:1 value ratio
        total_borrow = total_borrow.checked_add(borrow.amount).unwrap();
    }
    
    Ok(total_borrow)
}

// Account structures
#[account]
pub struct Market {
    pub authority: Pubkey,
    pub bump: u8,
    pub total_deposits: u64,
    pub total_borrows: u64,
    pub reserve_factor: u16,
    pub interest_rate_model: InterestRateModel,
}

#[account]
pub struct Reserve {
    pub market: Pubkey,
    pub mint: Pubkey,
    pub ltv_ratio: u16,
    pub liquidation_threshold: u16,
    pub liquidation_penalty: u16,
    pub bump: u8,
    pub total_deposits: u64,
    pub total_borrows: u64,
    pub deposit_index: u64,
    pub borrow_index: u64,
    pub last_update: u64,
}

#[account]
pub struct UserAccount {
    pub user: Pubkey,
    pub deposits: Vec<UserDeposit>,
    pub borrows: Vec<UserBorrow>,
    pub reward_preferences: Option<RewardPreferences>,
    pub stake_amount: u64,
    pub stake_start_time: i64,
    pub lock_duration_days: u32,
    pub intended_end_time: i64,
    pub accumulated_rewards: u64,
    pub last_payout_time: i64,
    pub total_rewards_received: u64,
    pub tier: UserTier,
    pub jupsol_amount: u64, // Amount of JupSOL held
    pub kamino_multiply_position: Option<Pubkey>, // Kamino multiply position
    pub immediate_liquidity_available: bool, // Whether user can withdraw immediately
}

#[account]
pub struct PermanentAccount {
    pub authority: Pubkey,
    pub total_penalties: u64,
    pub last_distribution: i64,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Default)]
pub struct UserDeposit {
    pub reserve: Pubkey,
    pub amount: u64,
    pub deposit_index: u64,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Default)]
pub struct UserBorrow {
    pub reserve: Pubkey,
    pub amount: u64,
    pub borrow_index: u64,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct InterestRateModel {
    pub base_rate: u16,
    pub multiplier: u16,
    pub jump_multiplier: u16,
    pub kink: u16,
}

// Context structures
#[derive(Accounts)]
pub struct InitializeMarket<'info> {
    #[account(
        init,
        payer = authority,
        space = 8 + 32 + 1 + 8 + 8 + 2 + 32,
        seeds = [b"market"],
        bump
    )]
    pub market: Account<'info, Market>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct AddReserve<'info> {
    #[account(mut)]
    pub market: Account<'info, Market>,
    #[account(
        init,
        payer = authority,
        space = 8 + 32 + 32 + 2 + 2 + 2 + 1 + 8 + 8 + 8 + 8 + 8,
        seeds = [b"reserve", market.key().as_ref(), mint.key().as_ref()],
        bump
    )]
    pub reserve: Account<'info, Reserve>,
    pub mint: Account<'info, Mint>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Deposit<'info> {
    #[account(mut)]
    pub market: Account<'info, Market>,
    #[account(mut)]
    pub reserve: Account<'info, Reserve>,
    #[account(
        init_if_needed,
        payer = user,
        associated_token::mint = reserve.mint,
        associated_token::authority = market,
    )]
    pub reserve_token_account: Account<'info, TokenAccount>,
    #[account(
        init_if_needed,
        payer = user,
        associated_token::mint = reserve.mint,
        associated_token::authority = user,
    )]
    pub user_token_account: Account<'info, TokenAccount>,
    #[account(
        init_if_needed,
        payer = user,
        space = 8 + 32 + 4 + 1000, // Approximate space for deposits/borrows
        seeds = [b"user_account", user.key().as_ref()],
        bump
    )]
    pub user_account: Account<'info, UserAccount>,
    #[account(mut)]
    pub user: Signer<'info>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Borrow<'info> {
    #[account(mut)]
    pub market: Account<'info, Market>,
    #[account(mut)]
    pub reserve: Account<'info, Reserve>,
    #[account(mut)]
    pub reserve_token_account: Account<'info, TokenAccount>,
    #[account(mut)]
    pub user_token_account: Account<'info, TokenAccount>,
    #[account(mut)]
    pub user_account: Account<'info, UserAccount>,
    #[account(mut)]
    pub user: Signer<'info>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct Repay<'info> {
    #[account(mut)]
    pub market: Account<'info, Market>,
    #[account(mut)]
    pub reserve: Account<'info, Reserve>,
    #[account(mut)]
    pub reserve_token_account: Account<'info, TokenAccount>,
    #[account(mut)]
    pub user_token_account: Account<'info, TokenAccount>,
    #[account(mut)]
    pub user_account: Account<'info, UserAccount>,
    #[account(mut)]
    pub user: Signer<'info>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct Withdraw<'info> {
    #[account(mut)]
    pub market: Account<'info, Market>,
    #[account(mut)]
    pub reserve: Account<'info, Reserve>,
    #[account(mut)]
    pub reserve_token_account: Account<'info, TokenAccount>,
    #[account(mut)]
    pub user_token_account: Account<'info, TokenAccount>,
    #[account(mut)]
    pub user_account: Account<'info, UserAccount>,
    #[account(mut)]
    pub user: Signer<'info>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct Liquidate<'info> {
    #[account(mut)]
    pub market: Account<'info, Market>,
    #[account(mut)]
    pub reserve: Account<'info, Reserve>,
    #[account(mut)]
    pub reserve_token_account: Account<'info, TokenAccount>,
    #[account(mut)]
    pub liquidator_token_account: Account<'info, TokenAccount>,
    #[account(mut)]
    pub liquidated_user_account: Account<'info, UserAccount>,
    #[account(mut)]
    pub liquidator_user_account: Account<'info, UserAccount>,
    #[account(mut)]
    pub liquidator: Signer<'info>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct FlashLoan<'info> {
    #[account(mut)]
    pub market: Account<'info, Market>,
    #[account(mut)]
    pub reserve: Account<'info, Reserve>,
    #[account(mut)]
    pub reserve_token_account: Account<'info, TokenAccount>,
    #[account(mut)]
    pub borrower_token_account: Account<'info, TokenAccount>,
    #[account(mut)]
    pub borrower: Signer<'info>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct DepositSol<'info> {
    #[account(mut)]
    pub market: Account<'info, Market>,
    #[account(mut)]
    pub sol_reserve: Account<'info, Reserve>,
    #[account(
        init_if_needed,
        payer = user,
        space = 8 + 32 + 4 + 1000, // Approximate space for deposits/borrows
        seeds = [b"user_account", user.key().as_ref()],
        bump
    )]
    pub user_account: Account<'info, UserAccount>,
    #[account(mut)]
    pub user: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct WithdrawSol<'info> {
    #[account(mut)]
    pub market: Account<'info, Market>,
    #[account(mut)]
    pub sol_reserve: Account<'info, Reserve>,
    #[account(mut)]
    pub user_account: Account<'info, UserAccount>,
    #[account(mut)]
    pub user: Signer<'info>,
    pub system_program: Program<'info, System>,
}

// Reward distribution contexts
#[derive(Accounts)]
pub struct SetRewardPreferences<'info> {
    #[account(mut)]
    pub user_account: Account<'info, UserAccount>,
    #[account(mut)]
    pub user: Signer<'info>,
}

#[derive(Accounts)]
pub struct DistributeRewards<'info> {
    #[account(mut)]
    pub market: Account<'info, Market>,
    #[account(mut)]
    pub user_account: Account<'info, UserAccount>,
    #[account(mut)]
    pub user: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct StakeWithImmediateLiquidity<'info> {
    #[account(mut)]
    pub market: Account<'info, Market>,
    #[account(
        init_if_needed,
        payer = user,
        space = 8 + 32 + 4 + 1000, // Approximate space for deposits/borrows
        seeds = [b"user_account", user.key().as_ref()],
        bump
    )]
    pub user_account: Account<'info, UserAccount>,
    #[account(mut)]
    pub user: Signer<'info>,
    pub jupiter_program: Program<'info, Jupiter>, // Jupiter program for JupSOL conversion
    pub kamino_program: Program<'info, Kamino>, // Kamino program for multiply
    #[account(mut)]
    pub kamino_position: Account<'info, KaminoPosition>, // Kamino multiply position
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct WithdrawWithImmediateLiquidity<'info> {
    #[account(mut)]
    pub market: Account<'info, Market>,
    #[account(mut)]
    pub user_account: Account<'info, UserAccount>,
    #[account(mut)]
    pub permanent_account: Account<'info, PermanentAccount>,
    #[account(mut)]
    pub user: Signer<'info>,
    pub jupiter_program: Program<'info, Jupiter>, // Jupiter program for JupSOL conversion
    pub kamino_program: Program<'info, Kamino>, // Kamino program for multiply
    #[account(mut)]
    pub kamino_position: Account<'info, KaminoPosition>, // Kamino multiply position
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct WithdrawStake<'info> {
    #[account(mut)]
    pub market: Account<'info, Market>,
    #[account(mut)]
    pub user_account: Account<'info, UserAccount>,
    #[account(mut)]
    pub permanent_account: Account<'info, PermanentAccount>,
    #[account(mut)]
    pub user: Signer<'info>,
    pub system_program: Program<'info, System>,
}

// Reward distribution functions
impl kamino_lending {
    /// Set user reward distribution preferences
    pub fn set_reward_preferences(
        ctx: Context<SetRewardPreferences>,
        preferences: RewardPreferences,
    ) -> Result<()> {
        let user_account = &mut ctx.accounts.user_account;
        user_account.reward_preferences = Some(preferences);
        Ok(())
    }

    /// Distribute rewards based on user preferences
    pub fn distribute_rewards(
        ctx: Context<DistributeRewards>,
    ) -> Result<()> {
        let user_account = &mut ctx.accounts.user_account;
        let market = &ctx.accounts.market;
        
        // Calculate current rewards
        let current_rewards = Self::calculate_current_rewards(user_account, market)?;
        
        if let Some(preferences) = &user_account.reward_preferences {
            match preferences.mode {
                RewardMode::RecurringInvestment => {
                    Self::handle_recurring_investment(ctx, current_rewards, preferences)?;
                }
                RewardMode::RealTimeBatch => {
                    Self::handle_real_time_batch(ctx, current_rewards, preferences)?;
                }
            }
        } else {
            // Default to immediate payout if no preferences set
            Self::payout_rewards(ctx, current_rewards)?;
        }
        
        Ok(())
    }

    /// Stake with custom lock duration and immediate liquidity via JupSOL + Kamino
    pub fn stake_with_immediate_liquidity(
        ctx: Context<StakeWithImmediateLiquidity>,
        amount: u64,
        lock_duration_days: Option<u32>,
        enable_multiply: bool,
    ) -> Result<()> {
        let duration = lock_duration_days.unwrap_or(1); // Default to 1 day
        let user_account = &mut ctx.accounts.user_account;
        let market = &mut ctx.accounts.market;
        
        // Step 1: Transfer SOL from user to market
        let transfer_ctx = CpiContext::new(
            ctx.accounts.system_program.to_account_info(),
            anchor_lang::system_program::Transfer {
                from: ctx.accounts.user.to_account_info(),
                to: ctx.accounts.market.to_account_info(),
            },
        );
        anchor_lang::system_program::transfer(transfer_ctx, amount)?;

        // Step 2: Convert SOL to JupSOL for immediate liquidity
        let jupsol_conversion_ctx = CpiContext::new(
            ctx.accounts.jupiter_program.to_account_info(),
            // Jupiter swap instruction would go here
            // For now, we'll simulate the conversion
        );
        
        // Simulate JupSOL conversion (in real implementation, this would call Jupiter)
        let jupsol_amount = amount; // 1:1 conversion for simplicity
        
        // Step 3: If multiply is enabled, create Kamino multiply position
        if enable_multiply {
            let multiply_ctx = CpiContext::new(
                ctx.accounts.kamino_program.to_account_info(),
                // Kamino multiply instruction would go here
                // For now, we'll simulate the position creation
            );
            
            // Simulate Kamino multiply position creation
            user_account.kamino_multiply_position = Some(ctx.accounts.kamino_position.key());
        }

        // Set user's stake details
        user_account.stake_amount = amount;
        user_account.jupsol_amount = jupsol_amount;
        user_account.stake_start_time = Clock::get()?.unix_timestamp;
        user_account.lock_duration_days = duration;
        user_account.intended_end_time = user_account.stake_start_time + (duration as i64 * 24 * 60 * 60);
        user_account.immediate_liquidity_available = true;
        
        // Initialize reward preferences with default values
        user_account.reward_preferences = Some(RewardPreferences {
            mode: RewardMode::RecurringInvestment,
            reinvestment_percentage: 80,
            compound_strategy: CompoundStrategy::Compound,
            batch_size: 0,
            batch_frequency: BatchFrequency::Instant,
            payout_threshold: 0,
            auto_compound: false,
            lock_duration_days: duration,
        });

        // Update market totals
        market.total_deposits = market.total_deposits.checked_add(amount).unwrap();

        Ok(())
    }

    /// Withdraw stake with immediate liquidity (JupSOL + Kamino unwinding)
    pub fn withdraw_with_immediate_liquidity(
        ctx: Context<WithdrawWithImmediateLiquidity>,
    ) -> Result<()> {
        let user_account = &mut ctx.accounts.user_account;
        let market = &mut ctx.accounts.market;
        let current_time = Clock::get()?.unix_timestamp;
        
        // Calculate if early exit
        let is_early_exit = current_time < user_account.intended_end_time;
        
        if is_early_exit {
            // Apply early exit penalty (total rewards for broken commitment)
            let penalty = Self::calculate_early_exit_penalty(user_account)?;
            
            // Step 1: Unwind Kamino multiply position (if exists)
            if let Some(kamino_position) = user_account.kamino_multiply_position {
                let unwind_ctx = CpiContext::new(
                    ctx.accounts.kamino_program.to_account_info(),
                    // Kamino unwind instruction would go here
                    // For now, we'll simulate the unwinding
                );
                
                // Simulate Kamino position unwinding
                // This would return the leveraged position value
            }
            
            // Step 2: Convert JupSOL back to SOL (immediate, no fees)
            let jupsol_to_sol_ctx = CpiContext::new(
                ctx.accounts.jupiter_program.to_account_info(),
                // Jupiter swap instruction would go here
                // For now, we'll simulate the conversion
            );
            
            // Simulate JupSOL to SOL conversion (immediate, no fees)
            let available_sol = user_account.jupsol_amount;
            
            // Step 3: Apply penalty and transfer remaining amount
            let withdrawal_amount = available_sol.checked_sub(penalty).unwrap();
            
            let transfer_ctx = CpiContext::new(
                ctx.accounts.system_program.to_account_info(),
                anchor_lang::system_program::Transfer {
                    from: ctx.accounts.market.to_account_info(),
                    to: ctx.accounts.user.to_account_info(),
                },
            );
            anchor_lang::system_program::transfer(transfer_ctx, withdrawal_amount)?;
            
            // Send penalty to permanent account
            let penalty_ctx = CpiContext::new(
                ctx.accounts.system_program.to_account_info(),
                anchor_lang::system_program::Transfer {
                    from: ctx.accounts.market.to_account_info(),
                    to: ctx.accounts.permanent_account.to_account_info(),
                },
            );
            anchor_lang::system_program::transfer(penalty_ctx, penalty)?;
            
            msg!("Early exit penalty applied: {} SOL", penalty);
        } else {
            // Full withdrawal without penalty - immediate liquidity
            // Step 1: Unwind Kamino multiply position (if exists)
            if let Some(kamino_position) = user_account.kamino_multiply_position {
                let unwind_ctx = CpiContext::new(
                    ctx.accounts.kamino_program.to_account_info(),
                    // Kamino unwind instruction would go here
                );
            }
            
            // Step 2: Convert JupSOL back to SOL (immediate, no fees)
            let jupsol_to_sol_ctx = CpiContext::new(
                ctx.accounts.jupiter_program.to_account_info(),
                // Jupiter swap instruction would go here
            );
            
            // Step 3: Transfer full amount to user
            let transfer_ctx = CpiContext::new(
                ctx.accounts.system_program.to_account_info(),
                anchor_lang::system_program::Transfer {
                    from: ctx.accounts.market.to_account_info(),
                    to: ctx.accounts.user.to_account_info(),
                },
            );
            anchor_lang::system_program::transfer(transfer_ctx, user_account.stake_amount)?;
            
            msg!("Full withdrawal completed with immediate liquidity");
        }
        
        // Reset user account
        user_account.stake_amount = 0;
        user_account.jupsol_amount = 0;
        user_account.kamino_multiply_position = None;
        user_account.stake_start_time = 0;
        user_account.lock_duration_days = 0;
        user_account.intended_end_time = 0;
        user_account.immediate_liquidity_available = false;
        user_account.reward_preferences = None;
        
        // Update market totals
        market.total_deposits = market.total_deposits.checked_sub(user_account.stake_amount).unwrap();

        Ok(())
    }

    /// Calculate early exit penalty (total rewards for broken commitment)
    fn calculate_early_exit_penalty(user_account: &UserAccount) -> Result<u64> {
        let current_time = Clock::get()?.unix_timestamp;
        let time_elapsed = current_time.checked_sub(user_account.stake_start_time).unwrap();
        let total_duration = user_account.intended_end_time.checked_sub(user_account.stake_start_time).unwrap();
        
        // Calculate total rewards for the full commitment period
        let total_commitment_rewards = Self::calculate_total_commitment_rewards(user_account)?;
        
        // Calculate realized rewards (what user actually earned)
        let realized_rewards = Self::calculate_realized_rewards(user_account)?;
        
        // Early exit penalty = Total commitment rewards (what they would have earned)
        // This ensures users pay the full cost of breaking their commitment
        let penalty = total_commitment_rewards;
        
        Ok(penalty)
    }

    /// Calculate total rewards for the full commitment period
    fn calculate_total_commitment_rewards(user_account: &UserAccount) -> Result<u64> {
        let total_duration = user_account.intended_end_time.checked_sub(user_account.stake_start_time).unwrap();
        
        // Base reward rate: 17% APY
        let base_reward_rate = 1700; // basis points
        let tier_multiplier = Self::get_tier_multiplier(user_account.tier);
        
        // Calculate total rewards for the full commitment period
        let total_rewards = user_account.stake_amount
            .checked_mul(base_reward_rate as u64)
            .unwrap()
            .checked_mul(total_duration as u64)
            .unwrap()
            .checked_mul(tier_multiplier as u64)
            .unwrap()
            .checked_div(365 * 24 * 60 * 60 * 10000) // Convert to daily rate
            .unwrap();
        
        Ok(total_rewards)
    }

    /// Calculate realized rewards
    fn calculate_realized_rewards(user_account: &UserAccount) -> Result<u64> {
        let current_time = Clock::get()?.unix_timestamp;
        let time_elapsed = current_time.checked_sub(user_account.stake_start_time).unwrap();
        
        // Base reward rate: 17% APY
        let base_reward_rate = 1700; // basis points
        let tier_multiplier = Self::get_tier_multiplier(user_account.tier);
        
        let rewards = user_account.stake_amount
            .checked_mul(base_reward_rate as u64)
            .unwrap()
            .checked_mul(time_elapsed as u64)
            .unwrap()
            .checked_mul(tier_multiplier as u64)
            .unwrap()
            .checked_div(365 * 24 * 60 * 60 * 10000) // Convert to daily rate
            .unwrap();
        
        Ok(rewards)
    }

    /// Get tier penalty multiplier
    fn get_tier_penalty_multiplier(tier: UserTier) -> u16 {
        match tier {
            UserTier::Diamond => 120, // 1.2x penalty
            UserTier::Gold => 110,    // 1.1x penalty
            UserTier::Silver => 100,  // 1.0x penalty
            UserTier::Bronze => 90,   // 0.9x penalty
        }
    }

    /// Handle recurring investment distribution
    fn handle_recurring_investment(
        ctx: Context<DistributeRewards>,
        rewards: u64,
        preferences: &RewardPreferences,
    ) -> Result<()> {
        let user_account = &mut ctx.accounts.user_account;
        
        let reinvestment_amount = rewards
            .checked_mul(preferences.reinvestment_percentage as u64)
            .unwrap()
            .checked_div(100)
            .unwrap();
        
        let payout_amount = rewards.checked_sub(reinvestment_amount).unwrap();
        
        // Reinvest into user's stake
        if reinvestment_amount > 0 {
            match preferences.compound_strategy {
                CompoundStrategy::Compound => {
                    // Reset start time for new compound period
                    user_account.stake_start_time = Clock::get()?.unix_timestamp;
                }
                CompoundStrategy::Simple => {
                    // Keep original lock period, just add to amount
                }
            }
            
            // Add to user's stake amount
            user_account.stake_amount = user_account.stake_amount
                .checked_add(reinvestment_amount)
                .unwrap();
        }
        
        // Payout remaining rewards
        if payout_amount > 0 {
            Self::payout_rewards(ctx, payout_amount)?;
        }
        
        Ok(())
    }

    /// Handle real-time batch distribution
    fn handle_real_time_batch(
        ctx: Context<DistributeRewards>,
        rewards: u64,
        preferences: &RewardPreferences,
    ) -> Result<()> {
        let user_account = &mut ctx.accounts.user_account;
        
        // Add to accumulated rewards
        user_account.accumulated_rewards = user_account.accumulated_rewards
            .checked_add(rewards)
            .unwrap();
        
        // Check if batch threshold is met
        if user_account.accumulated_rewards >= preferences.batch_size {
            let payout_amount = user_account.accumulated_rewards;
            user_account.accumulated_rewards = 0;
            user_account.last_payout_time = Clock::get()?.unix_timestamp;
            
            Self::payout_rewards(ctx, payout_amount)?;
        }
        
        Ok(())
    }

    /// Payout rewards to user
    fn payout_rewards(
        ctx: Context<DistributeRewards>,
        amount: u64,
    ) -> Result<()> {
        let user_account = &mut ctx.accounts.user_account;
        
        // Transfer SOL to user
        let transfer_ctx = CpiContext::new(
            ctx.accounts.system_program.to_account_info(),
            anchor_lang::system_program::Transfer {
                from: ctx.accounts.market.to_account_info(),
                to: ctx.accounts.user_account.to_account_info(),
            },
        );
        anchor_lang::system_program::transfer(transfer_ctx, amount)?;
        
        // Update user's total rewards received
        user_account.total_rewards_received = user_account.total_rewards_received
            .checked_add(amount)
            .unwrap();
        
        Ok(())
    }

    /// Calculate current rewards for user
    fn calculate_current_rewards(
        user_account: &UserAccount,
        market: &Market,
    ) -> Result<u64> {
        let current_time = Clock::get()?.unix_timestamp;
        let stake_duration = current_time.checked_sub(user_account.stake_start_time).unwrap();
        
        // Calculate rewards based on stake amount, duration, and tier
        let base_reward_rate = 1700; // 17% APY in basis points
        let tier_multiplier = Self::get_tier_multiplier(user_account.tier);
        
        let rewards = user_account.stake_amount
            .checked_mul(base_reward_rate as u64)
            .unwrap()
            .checked_mul(stake_duration as u64)
            .unwrap()
            .checked_mul(tier_multiplier as u64)
            .unwrap()
            .checked_div(365 * 24 * 60 * 60 * 10000) // Convert to daily rate
            .unwrap();
        
        Ok(rewards)
    }

    /// Get tier multiplier for reward calculation
    fn get_tier_multiplier(tier: UserTier) -> u16 {
        match tier {
            UserTier::Diamond => 150, // 1.5x multiplier
            UserTier::Gold => 125,    // 1.25x multiplier
            UserTier::Silver => 100,  // 1.0x multiplier
            UserTier::Bronze => 75,   // 0.75x multiplier
        }
    }
}

// Error definitions
#[error_code]
pub enum LendingError {
    #[msg("Insufficient collateral for borrow")]
    InsufficientCollateral,
    #[msg("Insufficient liquidity in reserve")]
    InsufficientLiquidity,
    #[msg("No borrow found for this reserve")]
    NoBorrowFound,
    #[msg("No deposit found for this reserve")]
    NoDepositFound,
    #[msg("Insufficient balance for withdrawal")]
    InsufficientBalance,
    #[msg("Position is not liquidatable")]
    PositionNotLiquidatable,
}
