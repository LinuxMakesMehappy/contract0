import React, { useState, useEffect } from 'react';
import { Connection, PublicKey } from '@solana/web3.js';
import { useWallet } from '@solana/wallet-adapter-react';
import {
  RewardDistributionInterface,
  RewardMode,
  CompoundStrategy,
  BatchFrequency,
  RewardPreferences,
} from './reward-interface';

interface RewardDistributionUIProps {
  connection: Connection;
  marketAddress: string;
  userAccountAddress: string;
}

export const RewardDistributionUI: React.FC<RewardDistributionUIProps> = ({
  connection,
  marketAddress,
  userAccountAddress,
}) => {
  const wallet = useWallet();
  const [rewardInterface, setRewardInterface] = useState<RewardDistributionInterface | null>(null);
  const [currentRewards, setCurrentRewards] = useState<number>(0);
  const [userAccount, setUserAccount] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');

  // Form state
  const [rewardMode, setRewardMode] = useState<RewardMode>(RewardMode.RecurringInvestment);
  const [reinvestmentPercentage, setReinvestmentPercentage] = useState<number>(80);
  const [compoundStrategy, setCompoundStrategy] = useState<CompoundStrategy>(CompoundStrategy.Compound);
  const [batchSize, setBatchSize] = useState<number>(1);
  const [batchFrequency, setBatchFrequency] = useState<BatchFrequency>(BatchFrequency.Daily);
  const [payoutThreshold, setPayoutThreshold] = useState<number>(0.1);
  const [autoCompound, setAutoCompound] = useState<boolean>(false);

  useEffect(() => {
    if (wallet.connected && wallet.publicKey) {
      const interface_ = new RewardDistributionInterface(connection, wallet);
      setRewardInterface(interface_);
      loadUserData();
    }
  }, [wallet.connected, wallet.publicKey, connection]);

  const loadUserData = async () => {
    if (!rewardInterface) return;
    
    try {
      setLoading(true);
      const userAccountPubkey = new PublicKey(userAccountAddress);
      const account = await rewardInterface.getUserAccount(userAccountPubkey);
      setUserAccount(account);
      
      const rewards = await rewardInterface.calculateEstimatedRewards(userAccountPubkey);
      setCurrentRewards(rewards);
    } catch (error) {
      console.error('Error loading user data:', error);
      setMessage('Error loading user data');
    } finally {
      setLoading(false);
    }
  };

  const handleSetPreferences = async () => {
    if (!rewardInterface || !wallet.publicKey) return;

    try {
      setLoading(true);
      setMessage('');

      const preferences: RewardPreferences = {
        mode: rewardMode,
        reinvestmentPercentage,
        compoundStrategy,
        batchSize,
        batchFrequency,
        payoutThreshold,
        autoCompound,
      };

      const userAccountPubkey = new PublicKey(userAccountAddress);
      const tx = await rewardInterface.setRewardPreferences(userAccountPubkey, preferences);
      
      setMessage(`Preferences set successfully! Transaction: ${tx}`);
      await loadUserData(); // Reload data
    } catch (error) {
      console.error('Error setting preferences:', error);
      setMessage('Error setting preferences');
    } finally {
      setLoading(false);
    }
  };

  const handleDistributeRewards = async () => {
    if (!rewardInterface || !wallet.publicKey) return;

    try {
      setLoading(true);
      setMessage('');

      const marketPubkey = new PublicKey(marketAddress);
      const userAccountPubkey = new PublicKey(userAccountAddress);
      const tx = await rewardInterface.distributeRewards(marketPubkey, userAccountPubkey);
      
      setMessage(`Rewards distributed successfully! Transaction: ${tx}`);
      await loadUserData(); // Reload data
    } catch (error) {
      console.error('Error distributing rewards:', error);
      setMessage('Error distributing rewards');
    } finally {
      setLoading(false);
    }
  };

  if (!wallet.connected) {
    return <div className="p-4">Please connect your wallet to continue.</div>;
  }

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-6">
      <h1 className="text-3xl font-bold text-center mb-8">
        Reward Distribution Settings
      </h1>

      {/* Current Status */}
      <div className="bg-gray-50 p-4 rounded-lg">
        <h2 className="text-xl font-semibold mb-4">Current Status</h2>
        {loading ? (
          <p>Loading...</p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <p className="text-sm text-gray-600">Stake Amount</p>
              <p className="text-lg font-semibold">
                {userAccount ? `${(userAccount.stakeAmount.toNumber() / 1e9).toFixed(4)} SOL` : 'N/A'}
              </p>
            </div>
            <div>
              <p className="text-sm text-gray-600">Current Rewards</p>
              <p className="text-lg font-semibold text-green-600">
                {currentRewards.toFixed(4)} SOL
              </p>
            </div>
            <div>
              <p className="text-sm text-gray-600">User Tier</p>
              <p className="text-lg font-semibold">
                {userAccount ? userAccount.tier : 'N/A'}
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Reward Distribution Mode */}
      <div className="bg-white p-6 rounded-lg shadow">
        <h2 className="text-xl font-semibold mb-4">Distribution Mode</h2>
        
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-2">Distribution Type</label>
            <select
              value={rewardMode}
              onChange={(e) => setRewardMode(e.target.value as RewardMode)}
              className="w-full p-2 border rounded-md"
            >
              <option value={RewardMode.RecurringInvestment}>Recurring Investment</option>
              <option value={RewardMode.RealTimeBatch}>Real-Time Batch</option>
            </select>
          </div>

          {rewardMode === RewardMode.RecurringInvestment && (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-2">
                  Reinvestment Percentage ({reinvestmentPercentage}%)
                </label>
                <input
                  type="range"
                  min="0"
                  max="100"
                  value={reinvestmentPercentage}
                  onChange={(e) => setReinvestmentPercentage(Number(e.target.value))}
                  className="w-full"
                />
                <p className="text-sm text-gray-600 mt-1">
                  {reinvestmentPercentage}% reinvested, {100 - reinvestmentPercentage}% paid out
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">Compound Strategy</label>
                <select
                  value={compoundStrategy}
                  onChange={(e) => setCompoundStrategy(e.target.value as CompoundStrategy)}
                  className="w-full p-2 border rounded-md"
                >
                  <option value={CompoundStrategy.Simple}>Simple (Keep original lock period)</option>
                  <option value={CompoundStrategy.Compound}>Compound (Reset lock period)</option>
                </select>
              </div>

              <div>
                <label className="flex items-center">
                  <input
                    type="checkbox"
                    checked={autoCompound}
                    onChange={(e) => setAutoCompound(e.target.checked)}
                    className="mr-2"
                  />
                  <span className="text-sm font-medium">Auto-compound when threshold met</span>
                </label>
              </div>
            </div>
          )}

          {rewardMode === RewardMode.RealTimeBatch && (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-2">Minimum Batch Size (SOL)</label>
                <input
                  type="number"
                  value={batchSize}
                  onChange={(e) => setBatchSize(Number(e.target.value))}
                  className="w-full p-2 border rounded-md"
                  step="0.1"
                  min="0"
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">Batch Frequency</label>
                <select
                  value={batchFrequency}
                  onChange={(e) => setBatchFrequency(e.target.value as BatchFrequency)}
                  className="w-full p-2 border rounded-md"
                >
                  <option value={BatchFrequency.Instant}>Instant (when threshold met)</option>
                  <option value={BatchFrequency.Hourly}>Hourly</option>
                  <option value={BatchFrequency.Daily}>Daily</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">Payout Threshold (SOL)</label>
                <input
                  type="number"
                  value={payoutThreshold}
                  onChange={(e) => setPayoutThreshold(Number(e.target.value))}
                  className="w-full p-2 border rounded-md"
                  step="0.1"
                  min="0"
                />
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Actions */}
      <div className="flex space-x-4">
        <button
          onClick={handleSetPreferences}
          disabled={loading}
          className="flex-1 bg-blue-600 text-white py-2 px-4 rounded-md hover:bg-blue-700 disabled:opacity-50"
        >
          {loading ? 'Setting...' : 'Set Preferences'}
        </button>
        
        <button
          onClick={handleDistributeRewards}
          disabled={loading || currentRewards <= 0}
          className="flex-1 bg-green-600 text-white py-2 px-4 rounded-md hover:bg-green-700 disabled:opacity-50"
        >
          {loading ? 'Distributing...' : `Distribute Rewards (${currentRewards.toFixed(4)} SOL)`}
        </button>
      </div>

      {/* Message */}
      {message && (
        <div className={`p-4 rounded-md ${
          message.includes('Error') ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'
        }`}>
          {message}
        </div>
      )}

      {/* Quick Actions */}
      <div className="bg-gray-50 p-4 rounded-lg">
        <h3 className="text-lg font-semibold mb-3">Quick Presets</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <button
            onClick={() => {
              setRewardMode(RewardMode.RecurringInvestment);
              setReinvestmentPercentage(100);
              setCompoundStrategy(CompoundStrategy.Compound);
              setAutoCompound(true);
            }}
            className="p-3 bg-purple-100 text-purple-700 rounded-md hover:bg-purple-200"
          >
            Max Compound (100% reinvest)
          </button>
          
          <button
            onClick={() => {
              setRewardMode(RewardMode.RecurringInvestment);
              setReinvestmentPercentage(50);
              setCompoundStrategy(CompoundStrategy.Simple);
              setAutoCompound(false);
            }}
            className="p-3 bg-blue-100 text-blue-700 rounded-md hover:bg-blue-200"
          >
            Balanced (50% reinvest)
          </button>
          
          <button
            onClick={() => {
              setRewardMode(RewardMode.RealTimeBatch);
              setBatchSize(1);
              setBatchFrequency(BatchFrequency.Instant);
              setPayoutThreshold(0.1);
            }}
            className="p-3 bg-green-100 text-green-700 rounded-md hover:bg-green-200"
          >
            Real-time (1 SOL batches)
          </button>
        </div>
      </div>
    </div>
  );
};
