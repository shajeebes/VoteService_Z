import { ConnectButton } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import React, { useEffect, useState } from "react";
import { getContractReadOnly, getContractWithSigner } from "./components/useContract";
import "./App.css";
import { useAccount } from 'wagmi';
import { useFhevm, useEncrypt, useDecrypt } from '../fhevm-sdk/src';
import { ethers } from 'ethers';

interface VotingData {
  id: string;
  name: string;
  description: string;
  creator: string;
  timestamp: number;
  encryptedValue: string;
  publicValue1: number;
  publicValue2: number;
  isVerified: boolean;
  decryptedValue: number;
  voteCount: number;
}

interface VoteStats {
  totalPolls: number;
  verifiedPolls: number;
  activeVotes: number;
  avgParticipation: number;
}

const App: React.FC = () => {
  const { address, isConnected } = useAccount();
  const [loading, setLoading] = useState(true);
  const [votingData, setVotingData] = useState<VotingData[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creatingVote, setCreatingVote] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{ visible: boolean; status: "pending" | "success" | "error"; message: string; }>({ 
    visible: false, 
    status: "pending", 
    message: "" 
  });
  const [newVoteData, setNewVoteData] = useState({ title: "", description: "", voteValue: "" });
  const [selectedVote, setSelectedVote] = useState<VotingData | null>(null);
  const [contractAddress, setContractAddress] = useState("");
  const [fhevmInitializing, setFhevmInitializing] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [stats, setStats] = useState<VoteStats>({ totalPolls: 0, verifiedPolls: 0, activeVotes: 0, avgParticipation: 0 });

  const { status, initialize, isInitialized } = useFhevm();
  const { encrypt, isEncrypting } = useEncrypt();
  const { verifyDecryption, isDecrypting: fheIsDecrypting } = useDecrypt();

  useEffect(() => {
    const initFhevmAfterConnection = async () => {
      if (!isConnected) return;
      if (isInitialized || fhevmInitializing) return;
      
      try {
        setFhevmInitializing(true);
        await initialize();
      } catch (error) {
        setTransactionStatus({ 
          visible: true, 
          status: "error", 
          message: "FHEVM initialization failed" 
        });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      } finally {
        setFhevmInitializing(false);
      }
    };

    initFhevmAfterConnection();
  }, [isConnected, isInitialized, initialize, fhevmInitializing]);

  useEffect(() => {
    const loadDataAndContract = async () => {
      if (!isConnected) {
        setLoading(false);
        return;
      }
      
      try {
        await loadData();
        const contract = await getContractReadOnly();
        if (contract) setContractAddress(await contract.getAddress());
      } catch (error) {
        console.error('Failed to load data:', error);
      } finally {
        setLoading(false);
      }
    };

    loadDataAndContract();
  }, [isConnected]);

  const loadData = async () => {
    if (!isConnected) return;
    
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const businessIds = await contract.getAllBusinessIds();
      const votesList: VotingData[] = [];
      
      for (const businessId of businessIds) {
        try {
          const businessData = await contract.getBusinessData(businessId);
          votesList.push({
            id: businessId,
            name: businessData.name,
            description: businessData.description,
            creator: businessData.creator,
            timestamp: Number(businessData.timestamp),
            encryptedValue: businessId,
            publicValue1: Number(businessData.publicValue1) || 0,
            publicValue2: Number(businessData.publicValue2) || 0,
            isVerified: businessData.isVerified,
            decryptedValue: Number(businessData.decryptedValue) || 0,
            voteCount: Number(businessData.publicValue1) || 0
          });
        } catch (e) {
          console.error('Error loading voting data:', e);
        }
      }
      
      setVotingData(votesList);
      updateStats(votesList);
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Failed to load data" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setIsRefreshing(false); 
    }
  };

  const updateStats = (votes: VotingData[]) => {
    const totalPolls = votes.length;
    const verifiedPolls = votes.filter(v => v.isVerified).length;
    const activeVotes = votes.reduce((sum, v) => sum + v.voteCount, 0);
    const avgParticipation = totalPolls > 0 ? activeVotes / totalPolls : 0;
    
    setStats({ totalPolls, verifiedPolls, activeVotes, avgParticipation });
  };

  const createVote = async () => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return; 
    }
    
    setCreatingVote(true);
    setTransactionStatus({ visible: true, status: "pending", message: "Creating secure vote with FHE..." });
    
    try {
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract with signer");
      
      const voteValue = parseInt(newVoteData.voteValue) || 1;
      const businessId = `vote-${Date.now()}`;
      
      const encryptedResult = await encrypt(contractAddress, address, voteValue);
      
      const tx = await contract.createBusinessData(
        businessId,
        newVoteData.title,
        encryptedResult.encryptedData,
        encryptedResult.proof,
        voteValue,
        0,
        newVoteData.description
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Waiting for transaction confirmation..." });
      await tx.wait();
      
      setTransactionStatus({ visible: true, status: "success", message: "Secure vote created successfully!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      await loadData();
      setShowCreateModal(false);
      setNewVoteData({ title: "", description: "", voteValue: "" });
    } catch (e: any) {
      const errorMessage = e.message?.includes("user rejected transaction") 
        ? "Transaction rejected by user" 
        : "Submission failed: " + (e.message || "Unknown error");
      setTransactionStatus({ visible: true, status: "error", message: errorMessage });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setCreatingVote(false); 
    }
  };

  const decryptData = async (businessId: string): Promise<number | null> => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    }
    
    try {
      const contractRead = await getContractReadOnly();
      if (!contractRead) return null;
      
      const businessData = await contractRead.getBusinessData(businessId);
      if (businessData.isVerified) {
        const storedValue = Number(businessData.decryptedValue) || 0;
        setTransactionStatus({ 
          visible: true, 
          status: "success", 
          message: "Data already verified on-chain" 
        });
        setTimeout(() => {
          setTransactionStatus({ visible: false, status: "pending", message: "" });
        }, 2000);
        return storedValue;
      }
      
      const contractWrite = await getContractWithSigner();
      if (!contractWrite) return null;
      
      const encryptedValueHandle = await contractRead.getEncryptedValue(businessId);
      
      const result = await verifyDecryption(
        [encryptedValueHandle],
        contractAddress,
        (abiEncodedClearValues: string, decryptionProof: string) => 
          contractWrite.verifyDecryption(businessId, abiEncodedClearValues, decryptionProof)
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Verifying decryption on-chain..." });
      const clearValue = result.decryptionResult.clearValues[encryptedValueHandle];
      
      await loadData();
      setTransactionStatus({ visible: true, status: "success", message: "Data decrypted and verified successfully!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      return Number(clearValue);
      
    } catch (e: any) { 
      if (e.message?.includes("Data already verified")) {
        setTransactionStatus({ 
          visible: true, 
          status: "success", 
          message: "Data is already verified on-chain" 
        });
        setTimeout(() => {
          setTransactionStatus({ visible: false, status: "pending", message: "" });
        }, 2000);
        await loadData();
        return null;
      }
      
      setTransactionStatus({ 
        visible: true, 
        status: "error", 
        message: "Decryption failed: " + (e.message || "Unknown error") 
      });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    }
  };

  const testAvailability = async () => {
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const isAvailable = await contract.isAvailable();
      if (isAvailable) {
        setTransactionStatus({ visible: true, status: "success", message: "FHE Service is available!" });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
      }
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Service check failed" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    }
  };

  const filteredVotes = votingData.filter(vote =>
    vote.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    vote.description.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const renderStatsDashboard = () => (
    <div className="stats-dashboard">
      <div className="stat-panel bronze-panel">
        <div className="stat-icon">📊</div>
        <div className="stat-content">
          <h3>Total Polls</h3>
          <div className="stat-value">{stats.totalPolls}</div>
          <div className="stat-trend">FHE Protected</div>
        </div>
      </div>
      
      <div className="stat-panel bronze-panel">
        <div className="stat-icon">✅</div>
        <div className="stat-content">
          <h3>Verified Data</h3>
          <div className="stat-value">{stats.verifiedPolls}</div>
          <div className="stat-trend">On-chain Verified</div>
        </div>
      </div>
      
      <div className="stat-panel bronze-panel">
        <div className="stat-icon">🗳️</div>
        <div className="stat-content">
          <h3>Active Votes</h3>
          <div className="stat-value">{stats.activeVotes}</div>
          <div className="stat-trend">Encrypted Count</div>
        </div>
      </div>
      
      <div className="stat-panel bronze-panel">
        <div className="stat-icon">👥</div>
        <div className="stat-content">
          <h3>Avg Participation</h3>
          <div className="stat-value">{stats.avgParticipation.toFixed(1)}</div>
          <div className="stat-trend">Per Poll</div>
        </div>
      </div>
    </div>
  );

  const renderRealTimeChart = () => (
    <div className="realtime-chart bronze-panel">
      <h3>Voting Activity Timeline</h3>
      <div className="chart-container">
        {votingData.slice(-10).map((vote, index) => (
          <div key={vote.id} className="chart-bar">
            <div 
              className="bar-fill" 
              style={{ height: `${Math.min(100, vote.voteCount * 20)}%` }}
              title={`${vote.name}: ${vote.voteCount} votes`}
            >
              <span className="bar-label">{vote.voteCount}</span>
            </div>
            <div className="bar-date">
              {new Date(vote.timestamp * 1000).getDate()}/{new Date(vote.timestamp * 1000).getMonth() + 1}
            </div>
          </div>
        ))}
      </div>
    </div>
  );

  const renderFHEFlow = () => (
    <div className="fhe-flow bronze-panel">
      <h3>FHE 🔐 Voting Process</h3>
      <div className="flow-steps">
        <div className="flow-step">
          <div className="step-number">1</div>
          <div className="step-content">
            <h4>Encrypt Vote</h4>
            <p>Vote value encrypted client-side using Zama FHE</p>
          </div>
        </div>
        <div className="flow-arrow">→</div>
        <div className="flow-step">
          <div className="step-number">2</div>
          <div className="step-content">
            <h4>Store on Chain</h4>
            <p>Encrypted data stored publicly on blockchain</p>
          </div>
        </div>
        <div className="flow-arrow">→</div>
        <div className="flow-step">
          <div className="step-number">3</div>
          <div className="step-content">
            <h4>Homomorphic Tally</h4>
            <p>Votes counted without decryption</p>
          </div>
        </div>
        <div className="flow-arrow">→</div>
        <div className="flow-step">
          <div className="step-number">4</div>
          <div className="step-content">
            <h4>Verify Results</h4>
            <p>Decrypt final tally with proof verification</p>
          </div>
        </div>
      </div>
    </div>
  );

  if (!isConnected) {
    return (
      <div className="app-container">
        <header className="app-header">
          <div className="logo">
            <h1>FHE Secure Voting 🔐</h1>
            <p>Fully Homomorphic Encrypted Voting Platform</p>
          </div>
          <div className="header-actions">
            <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
          </div>
        </header>
        
        <div className="connection-prompt">
          <div className="connection-content">
            <div className="connection-icon">🔐</div>
            <h2>Connect Wallet to Access Secure Voting</h2>
            <p>FHE technology ensures your vote remains encrypted throughout the entire process</p>
            <div className="connection-features">
              <div className="feature">
                <span className="feature-icon">🔒</span>
                <p>End-to-end encryption</p>
              </div>
              <div className="feature">
                <span className="feature-icon">📊</span>
                <p>Homomorphic tallying</p>
              </div>
              <div className="feature">
                <span className="feature-icon">✅</span>
                <p>Verifiable results</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!isInitialized || fhevmInitializing) {
    return (
      <div className="loading-screen">
        <div className="fhe-spinner"></div>
        <p>Initializing FHE Encryption System...</p>
        <p className="loading-note">Secure voting infrastructure loading</p>
      </div>
    );
  }

  if (loading) return (
    <div className="loading-screen">
      <div className="fhe-spinner"></div>
      <p>Loading secure voting platform...</p>
    </div>
  );

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="logo">
          <h1>FHE Secure Voting 🔐</h1>
          <p>Zero-Knowledge Verifiable Elections</p>
        </div>
        
        <div className="header-actions">
          <button onClick={testAvailability} className="test-btn">
            Check Service
          </button>
          <button onClick={() => setShowCreateModal(true)} className="create-btn">
            + New Vote
          </button>
          <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
        </div>
      </header>
      
      <div className="main-content">
        <div className="dashboard-section">
          <h2>Secure Voting Dashboard</h2>
          {renderStatsDashboard()}
          
          <div className="dashboard-grid">
            {renderRealTimeChart()}
            {renderFHEFlow()}
          </div>
        </div>
        
        <div className="votes-section">
          <div className="section-header">
            <h2>Active Voting Polls</h2>
            <div className="header-controls">
              <div className="search-box">
                <input
                  type="text"
                  placeholder="Search polls..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="search-input"
                />
              </div>
              <button onClick={loadData} className="refresh-btn" disabled={isRefreshing}>
                {isRefreshing ? "🔄" : "Refresh"}
              </button>
            </div>
          </div>
          
          <div className="votes-list">
            {filteredVotes.length === 0 ? (
              <div className="no-votes">
                <p>No voting polls found</p>
                <button onClick={() => setShowCreateModal(true)} className="create-btn">
                  Create First Poll
                </button>
              </div>
            ) : filteredVotes.map((vote) => (
              <div 
                className={`vote-item ${vote.isVerified ? "verified" : ""}`}
                key={vote.id}
                onClick={() => setSelectedVote(vote)}
              >
                <div className="vote-header">
                  <h3>{vote.name}</h3>
                  <span className={`status-badge ${vote.isVerified ? "verified" : "pending"}`}>
                    {vote.isVerified ? "✅ Verified" : "🔒 Encrypted"}
                  </span>
                </div>
                <p className="vote-description">{vote.description}</p>
                <div className="vote-meta">
                  <span>Votes: {vote.voteCount}</span>
                  <span>Created: {new Date(vote.timestamp * 1000).toLocaleDateString()}</span>
                  <span>By: {vote.creator.substring(0, 8)}...</span>
                </div>
                {vote.isVerified && (
                  <div className="decrypted-result">
                    Final Tally: {vote.decryptedValue} votes
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
      
      {showCreateModal && (
        <CreateVoteModal 
          onSubmit={createVote}
          onClose={() => setShowCreateModal(false)}
          creating={creatingVote}
          voteData={newVoteData}
          setVoteData={setNewVoteData}
          isEncrypting={isEncrypting}
        />
      )}
      
      {selectedVote && (
        <VoteDetailModal
          vote={selectedVote}
          onClose={() => setSelectedVote(null)}
          onDecrypt={() => decryptData(selectedVote.id)}
          isDecrypting={fheIsDecrypting}
        />
      )}
      
      {transactionStatus.visible && (
        <div className={`transaction-toast ${transactionStatus.status}`}>
          <div className="toast-content">
            <span className="toast-icon">
              {transactionStatus.status === "pending" && "⏳"}
              {transactionStatus.status === "success" && "✅"}
              {transactionStatus.status === "error" && "❌"}
            </span>
            <span>{transactionStatus.message}</span>
          </div>
        </div>
      )}

      <footer className="app-footer">
        <div className="footer-content">
          <p>FHE Secure Voting Platform - Powered by Zama FHE Technology</p>
          <div className="footer-links">
            <span>🔐 End-to-End Encryption</span>
            <span>📊 Homomorphic Tallying</span>
            <span>✅ Verifiable Results</span>
          </div>
        </div>
      </footer>
    </div>
  );
};

const CreateVoteModal: React.FC<{
  onSubmit: () => void;
  onClose: () => void;
  creating: boolean;
  voteData: any;
  setVoteData: (data: any) => void;
  isEncrypting: boolean;
}> = ({ onSubmit, onClose, creating, voteData, setVoteData, isEncrypting }) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    if (name === 'voteValue') {
      const intValue = value.replace(/[^\d]/g, '');
      setVoteData({ ...voteData, [name]: intValue });
    } else {
      setVoteData({ ...voteData, [name]: value });
    }
  };

  return (
    <div className="modal-overlay">
      <div className="create-modal bronze-modal">
        <div className="modal-header">
          <h2>Create New Secure Vote</h2>
          <button onClick={onClose} className="close-btn">×</button>
        </div>
        
        <div className="modal-body">
          <div className="fhe-notice">
            <div className="notice-icon">🔐</div>
            <div>
              <strong>FHE Encrypted Voting</strong>
              <p>Vote count will be encrypted using Zama FHE technology</p>
            </div>
          </div>
          
          <div className="form-group">
            <label>Vote Title *</label>
            <input
              type="text"
              name="title"
              value={voteData.title}
              onChange={handleChange}
              placeholder="Enter vote title..."
              className="form-input"
            />
          </div>
          
          <div className="form-group">
            <label>Description</label>
            <textarea
              name="description"
              value={voteData.description}
              onChange={handleChange}
              placeholder="Describe this vote..."
              className="form-textarea"
              rows={3}
            />
          </div>
          
          <div className="form-group">
            <label>Initial Vote Count (Integer) *</label>
            <input
              type="number"
              name="voteValue"
              value={voteData.voteValue}
              onChange={handleChange}
              placeholder="Enter initial vote count..."
              min="0"
              step="1"
              className="form-input"
            />
            <div className="input-hint">FHE Encrypted Integer</div>
          </div>
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="cancel-btn">Cancel</button>
          <button
            onClick={onSubmit}
            disabled={creating || isEncrypting || !voteData.title || !voteData.voteValue}
            className="submit-btn"
          >
            {creating || isEncrypting ? "Encrypting..." : "Create Secure Vote"}
          </button>
        </div>
      </div>
    </div>
  );
};

const VoteDetailModal: React.FC<{
  vote: VotingData;
  onClose: () => void;
  onDecrypt: () => Promise<number | null>;
  isDecrypting: boolean;
}> = ({ vote, onClose, onDecrypt, isDecrypting }) => {
  const [localDecrypted, setLocalDecrypted] = useState<number | null>(null);

  const handleDecrypt = async () => {
    const result = await onDecrypt();
    setLocalDecrypted(result);
  };

  return (
    <div className="modal-overlay">
      <div className="detail-modal bronze-modal">
        <div className="modal-header">
          <h2>Vote Details</h2>
          <button onClick={onClose} className="close-btn">×</button>
        </div>
        
        <div className="modal-body">
          <div className="vote-info">
            <div className="info-row">
              <span>Title:</span>
              <strong>{vote.name}</strong>
            </div>
            <div className="info-row">
              <span>Description:</span>
              <p>{vote.description}</p>
            </div>
            <div className="info-row">
              <span>Creator:</span>
              <code>{vote.creator}</code>
            </div>
            <div className="info-row">
              <span>Created:</span>
              <span>{new Date(vote.timestamp * 1000).toLocaleString()}</span>
            </div>
          </div>
          
          <div className="encryption-section">
            <h3>FHE Encryption Status</h3>
            <div className={`encryption-status ${vote.isVerified ? 'verified' : 'encrypted'}`}>
              <div className="status-icon">
                {vote.isVerified ? '✅' : '🔐'}
              </div>
              <div className="status-content">
                <h4>{vote.isVerified ? 'On-Chain Verified' : 'FHE Encrypted'}</h4>
                <p>
                  {vote.isVerified 
                    ? `Final tally: ${vote.decryptedValue} votes (verified on-chain)`
                    : 'Vote count is encrypted using FHE technology'
                  }
                </p>
              </div>
            </div>
            
            {!vote.isVerified && (
              <button
                onClick={handleDecrypt}
                disabled={isDecrypting}
                className={`decrypt-btn ${localDecrypted !== null ? 'decrypted' : ''}`}
              >
                {isDecrypting ? '🔓 Verifying...' : 
                 localDecrypted !== null ? `✅ ${localDecrypted} votes` : 
                 '🔓 Verify Tally'}
              </button>
            )}
          </div>
          
          <div className="technical-info">
            <h3>Technical Details</h3>
            <div className="tech-grid">
              <div className="tech-item">
                <span>Public Value 1:</span>
                <code>{vote.publicValue1}</code>
              </div>
              <div className="tech-item">
                <span>Public Value 2:</span>
                <code>{vote.publicValue2}</code>
              </div>
              <div className="tech-item">
                <span>Vote ID:</span>
                <code className="vote-id">{vote.id}</code>
              </div>
            </div>
          </div>
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="close-btn">Close</button>
          {!vote.isVerified && (
            <button
              onClick={handleDecrypt}
              disabled={isDecrypting}
              className="verify-btn"
            >
              {isDecrypting ? 'Verifying...' : 'Verify on Chain'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default App;

