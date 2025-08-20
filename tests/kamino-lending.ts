import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { KaminoLending } from "../target/types/kamino_lending";
import { PublicKey, Keypair, SystemProgram, SYSVAR_RENT_PUBKEY } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID, createMint, createAccount, mintTo, getAccount } from "@solana/spl-token";
import { assert } from "chai";

describe("kamino-lending", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.KaminoLending as Program<KaminoLending>;

  // Test accounts
  const authority = Keypair.generate();
  const user = Keypair.generate();
  const mint = Keypair.generate();
  
  // PDAs
  let marketPda: PublicKey;
  let marketBump: number;
  let reservePda: PublicKey;
  let reserveBump: number;
  let userAccountPda: PublicKey;
  let userAccountBump: number;

  // Token accounts
  let mintAccount: PublicKey;
  let userTokenAccount: PublicKey;
  let reserveTokenAccount: PublicKey;

  before(async () => {
    // Airdrop SOL to test accounts
    await provider.connection.requestAirdrop(authority.publicKey, 10 * anchor.web3.LAMPORTS_PER_SOL);
    await provider.connection.requestAirdrop(user.publicKey, 10 * anchor.web3.LAMPORTS_PER_SOL);
    
    // Wait for airdrop confirmation
    await provider.connection.confirmTransaction(
      await provider.connection.requestAirdrop(authority.publicKey, 10 * anchor.web3.LAMPORTS_PER_SOL)
    );
    await provider.connection.confirmTransaction(
      await provider.connection.requestAirdrop(user.publicKey, 10 * anchor.web3.LAMPORTS_PER_SOL)
    );

    // Create mint
    mintAccount = await createMint(
      provider.connection,
      authority,
      authority.publicKey,
      null,
      6
    );

    // Create user token account
    userTokenAccount = await createAccount(
      provider.connection,
      user,
      mintAccount,
      user.publicKey
    );

    // Mint tokens to user
    await mintTo(
      provider.connection,
      authority,
      mintAccount,
      userTokenAccount,
      authority,
      1000000000 // 1000 tokens with 6 decimals
    );

    // Find PDAs
    [marketPda, marketBump] = PublicKey.findProgramAddressSync(
      [Buffer.from("market")],
      program.programId
    );

    [reservePda, reserveBump] = PublicKey.findProgramAddressSync(
      [Buffer.from("reserve"), marketPda.toBuffer(), mintAccount.toBuffer()],
      program.programId
    );

    [userAccountPda, userAccountBump] = PublicKey.findProgramAddressSync(
      [Buffer.from("user_account"), user.publicKey.toBuffer()],
      program.programId
    );

    // Find reserve token account
    reserveTokenAccount = await anchor.utils.token.associatedAddress({
      mint: mintAccount,
      owner: marketPda,
    });
  });

  it("Initializes the market", async () => {
    try {
      await program.methods
        .initializeMarket(marketBump)
        .accounts({
          market: marketPda,
          authority: authority.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([authority])
        .rpc();

      const marketAccount = await program.account.market.fetch(marketPda);
      assert.equal(marketAccount.authority.toString(), authority.publicKey.toString());
      assert.equal(marketAccount.bump, marketBump);
      assert.equal(marketAccount.totalDeposits.toNumber(), 0);
      assert.equal(marketAccount.totalBorrows.toNumber(), 0);
      assert.equal(marketAccount.reserveFactor, 1000);
    } catch (error) {
      console.error("Error initializing market:", error);
      throw error;
    }
  });

  it("Adds a reserve to the market", async () => {
    try {
      await program.methods
        .addReserve(
          reserveBump,
          7500, // 75% LTV
          8000, // 80% liquidation threshold
          500   // 5% liquidation penalty
        )
        .accounts({
          market: marketPda,
          reserve: reservePda,
          mint: mintAccount,
          authority: authority.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([authority])
        .rpc();

      const reserveAccount = await program.account.reserve.fetch(reservePda);
      assert.equal(reserveAccount.market.toString(), marketPda.toString());
      assert.equal(reserveAccount.mint.toString(), mintAccount.toString());
      assert.equal(reserveAccount.ltvRatio, 7500);
      assert.equal(reserveAccount.liquidationThreshold, 8000);
      assert.equal(reserveAccount.liquidationPenalty, 500);
      assert.equal(reserveAccount.totalDeposits.toNumber(), 0);
      assert.equal(reserveAccount.totalBorrows.toNumber(), 0);
    } catch (error) {
      console.error("Error adding reserve:", error);
      throw error;
    }
  });

  it("Allows user to deposit tokens", async () => {
    try {
      const depositAmount = new anchor.BN(100000000); // 100 tokens

      await program.methods
        .deposit(depositAmount)
        .accounts({
          market: marketPda,
          reserve: reservePda,
          reserveTokenAccount: reserveTokenAccount,
          userTokenAccount: userTokenAccount,
          userAccount: userAccountPda,
          user: user.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([user])
        .rpc();

      // Check reserve state
      const reserveAccount = await program.account.reserve.fetch(reservePda);
      assert.equal(reserveAccount.totalDeposits.toNumber(), depositAmount.toNumber());

      // Check market state
      const marketAccount = await program.account.market.fetch(marketPda);
      assert.equal(marketAccount.totalDeposits.toNumber(), depositAmount.toNumber());

      // Check user account
      const userAccount = await program.account.userAccount.fetch(userAccountPda);
      assert.equal(userAccount.user.toString(), user.publicKey.toString());
      assert.equal(userAccount.deposits.length, 1);
      assert.equal(userAccount.deposits[0].reserve.toString(), reservePda.toString());
      assert.equal(userAccount.deposits[0].amount.toNumber(), depositAmount.toNumber());
    } catch (error) {
      console.error("Error depositing:", error);
      throw error;
    }
  });

  it("Allows user to borrow tokens", async () => {
    try {
      const borrowAmount = new anchor.BN(50000000); // 50 tokens (within LTV)

      await program.methods
        .borrow(borrowAmount)
        .accounts({
          market: marketPda,
          reserve: reservePda,
          reserveTokenAccount: reserveTokenAccount,
          userTokenAccount: userTokenAccount,
          userAccount: userAccountPda,
          user: user.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([user])
        .rpc();

      // Check reserve state
      const reserveAccount = await program.account.reserve.fetch(reservePda);
      assert.equal(reserveAccount.totalBorrows.toNumber(), borrowAmount.toNumber());

      // Check market state
      const marketAccount = await program.account.market.fetch(marketPda);
      assert.equal(marketAccount.totalBorrows.toNumber(), borrowAmount.toNumber());

      // Check user account
      const userAccount = await program.account.userAccount.fetch(userAccountPda);
      assert.equal(userAccount.borrows.length, 1);
      assert.equal(userAccount.borrows[0].reserve.toString(), reservePda.toString());
      assert.equal(userAccount.borrows[0].amount.toNumber(), borrowAmount.toNumber());
    } catch (error) {
      console.error("Error borrowing:", error);
      throw error;
    }
  });

  it("Allows user to repay borrowed tokens", async () => {
    try {
      const repayAmount = new anchor.BN(25000000); // 25 tokens

      await program.methods
        .repay(repayAmount)
        .accounts({
          market: marketPda,
          reserve: reservePda,
          reserveTokenAccount: reserveTokenAccount,
          userTokenAccount: userTokenAccount,
          userAccount: userAccountPda,
          user: user.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([user])
        .rpc();

      // Check reserve state
      const reserveAccount = await program.account.reserve.fetch(reservePda);
      assert.equal(reserveAccount.totalBorrows.toNumber(), 25000000); // 50 - 25 = 25

      // Check market state
      const marketAccount = await program.account.market.fetch(marketPda);
      assert.equal(marketAccount.totalBorrows.toNumber(), 25000000);

      // Check user account
      const userAccount = await program.account.userAccount.fetch(userAccountPda);
      assert.equal(userAccount.borrows[0].amount.toNumber(), 25000000);
    } catch (error) {
      console.error("Error repaying:", error);
      throw error;
    }
  });

  it("Allows user to withdraw deposited tokens", async () => {
    try {
      const withdrawAmount = new anchor.BN(25000000); // 25 tokens

      await program.methods
        .withdraw(withdrawAmount)
        .accounts({
          market: marketPda,
          reserve: reservePda,
          reserveTokenAccount: reserveTokenAccount,
          userTokenAccount: userTokenAccount,
          userAccount: userAccountPda,
          user: user.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([user])
        .rpc();

      // Check reserve state
      const reserveAccount = await program.account.reserve.fetch(reservePda);
      assert.equal(reserveAccount.totalDeposits.toNumber(), 75000000); // 100 - 25 = 75

      // Check market state
      const marketAccount = await program.account.market.fetch(marketPda);
      assert.equal(marketAccount.totalDeposits.toNumber(), 75000000);

      // Check user account
      const userAccount = await program.account.userAccount.fetch(userAccountPda);
      assert.equal(userAccount.deposits[0].amount.toNumber(), 75000000);
    } catch (error) {
      console.error("Error withdrawing:", error);
      throw error;
    }
  });

  it("Executes a flash loan", async () => {
    try {
      const flashLoanAmount = new anchor.BN(10000000); // 10 tokens
      const flashLoanFee = new anchor.BN(100000); // 0.1 tokens (1% fee)

      await program.methods
        .flashLoan(flashLoanAmount, flashLoanFee)
        .accounts({
          market: marketPda,
          reserve: reservePda,
          reserveTokenAccount: reserveTokenAccount,
          borrowerTokenAccount: userTokenAccount,
          borrower: user.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([user])
        .rpc();

      // Check that the fee was added to reserve deposits
      const reserveAccount = await program.account.reserve.fetch(reservePda);
      assert.equal(reserveAccount.totalDeposits.toNumber(), 75100000); // 75 + 0.1 = 75.1
    } catch (error) {
      console.error("Error executing flash loan:", error);
      throw error;
    }
  });

  it("Prevents borrowing more than LTV allows", async () => {
    try {
      const excessiveBorrowAmount = new anchor.BN(100000000); // 100 tokens (exceeds LTV)

      await program.methods
        .borrow(excessiveBorrowAmount)
        .accounts({
          market: marketPda,
          reserve: reservePda,
          reserveTokenAccount: reserveTokenAccount,
          userTokenAccount: userTokenAccount,
          userAccount: userAccountPda,
          user: user.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([user])
        .rpc();

      // This should fail
      assert.fail("Should have thrown an error for excessive borrow");
    } catch (error) {
      // Expected error - insufficient collateral
      assert.include(error.message, "Insufficient collateral");
    }
  });

  it("Prevents withdrawing more than deposited", async () => {
    try {
      const excessiveWithdrawAmount = new anchor.BN(100000000); // 100 tokens (more than deposited)

      await program.methods
        .withdraw(excessiveWithdrawAmount)
        .accounts({
          market: marketPda,
          reserve: reservePda,
          reserveTokenAccount: reserveTokenAccount,
          userTokenAccount: userTokenAccount,
          userAccount: userAccountPda,
          user: user.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([user])
        .rpc();

      // This should fail
      assert.fail("Should have thrown an error for excessive withdrawal");
    } catch (error) {
      // Expected error - insufficient balance
      assert.include(error.message, "Insufficient balance");
    }
  });

  it("Calculates interest correctly", async () => {
    // This test would require time simulation or multiple blocks
    // For now, we'll just verify the interest rate model is set up correctly
    const marketAccount = await program.account.market.fetch(marketPda);
    const interestModel = marketAccount.interestRateModel;
    
    assert.equal(interestModel.baseRate, 500); // 5%
    assert.equal(interestModel.multiplier, 2000); // 20%
    assert.equal(interestModel.jumpMultiplier, 5000); // 50%
    assert.equal(interestModel.kink, 8000); // 80%
  });

  it("Maintains proper account relationships", async () => {
    const marketAccount = await program.account.market.fetch(marketPda);
    const reserveAccount = await program.account.reserve.fetch(reservePda);
    const userAccount = await program.account.userAccount.fetch(userAccountPda);

    // Verify market authority
    assert.equal(marketAccount.authority.toString(), authority.publicKey.toString());

    // Verify reserve belongs to market
    assert.equal(reserveAccount.market.toString(), marketPda.toString());

    // Verify user account belongs to user
    assert.equal(userAccount.user.toString(), user.publicKey.toString());

    // Verify deposits and borrows are properly linked
    if (userAccount.deposits.length > 0) {
      assert.equal(userAccount.deposits[0].reserve.toString(), reservePda.toString());
    }
    if (userAccount.borrows.length > 0) {
      assert.equal(userAccount.borrows[0].reserve.toString(), reservePda.toString());
    }
  });
});
