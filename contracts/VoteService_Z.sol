pragma solidity ^0.8.24;

import { FHE, euint32, externalEuint32 } from "@fhevm/solidity/lib/FHE.sol";
import { ZamaEthereumConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract VotingService is ZamaEthereumConfig {
    struct Vote {
        euint32 encryptedVote;
        address voter;
        uint256 timestamp;
        uint32 decryptedVote;
        bool isVerified;
    }

    struct Poll {
        string pollId;
        string question;
        uint256 endTime;
        uint32 totalVotes;
        bool isActive;
        mapping(address => bool) hasVoted;
    }

    mapping(string => Poll) public polls;
    mapping(string => Vote[]) public pollVotes;
    string[] public pollIds;

    event PollCreated(string indexed pollId, address indexed creator);
    event VoteCast(string indexed pollId, address indexed voter);
    event VoteDecrypted(string indexed pollId, uint32 voteValue);
    event PollClosed(string indexed pollId, uint32 totalVotes);

    modifier onlyPollOwner(string calldata pollId) {
        require(msg.sender == polls[pollId].owner, "Not poll owner");
        _;
    }

    constructor() ZamaEthereumConfig() {}

    function createPoll(
        string calldata pollId,
        string calldata question,
        uint256 duration
    ) external {
        require(bytes(polls[pollId].question).length == 0, "Poll already exists");
        polls[pollId] = Poll({
            pollId: pollId,
            question: question,
            endTime: block.timestamp + duration,
            totalVotes: 0,
            isActive: true
        });
        pollIds.push(pollId);
        emit PollCreated(pollId, msg.sender);
    }

    function castVote(
        string calldata pollId,
        externalEuint32 encryptedVote,
        bytes calldata inputProof
    ) external {
        require(bytes(polls[pollId].question).length > 0, "Poll does not exist");
        require(block.timestamp < polls[pollId].endTime, "Voting period ended");
        require(!polls[pollId].hasVoted[msg.sender], "Already voted");

        require(FHE.isInitialized(FHE.fromExternal(encryptedVote, inputProof)), "Invalid encrypted vote");

        Vote memory newVote = Vote({
            encryptedVote: FHE.fromExternal(encryptedVote, inputProof),
            voter: msg.sender,
            timestamp: block.timestamp,
            decryptedVote: 0,
            isVerified: false
        });

        FHE.allowThis(newVote.encryptedVote);
        FHE.makePubliclyDecryptable(newVote.encryptedVote);

        pollVotes[pollId].push(newVote);
        polls[pollId].hasVoted[msg.sender] = true;
        polls[pollId].totalVotes++;

        emit VoteCast(pollId, msg.sender);
    }

    function verifyVote(
        string calldata pollId,
        uint256 voteIndex,
        bytes memory abiEncodedClearVote,
        bytes memory decryptionProof
    ) external {
        require(bytes(polls[pollId].question).length > 0, "Poll does not exist");
        require(voteIndex < pollVotes[pollId].length, "Invalid vote index");
        require(!pollVotes[pollId][voteIndex].isVerified, "Vote already verified");

        bytes32[] memory cts = new bytes32[](1);
        cts[0] = FHE.toBytes32(pollVotes[pollId][voteIndex].encryptedVote);

        FHE.checkSignatures(cts, abiEncodedClearVote, decryptionProof);

        uint32 decodedVote = abi.decode(abiEncodedClearVote, (uint32));
        pollVotes[pollId][voteIndex].decryptedVote = decodedVote;
        pollVotes[pollId][voteIndex].isVerified = true;

        emit VoteDecrypted(pollId, decodedVote);
    }

    function closePoll(string calldata pollId) external onlyPollOwner(pollId) {
        require(bytes(polls[pollId].question).length > 0, "Poll does not exist");
        require(block.timestamp >= polls[pollId].endTime, "Voting still in progress");
        require(polls[pollId].isActive, "Poll already closed");

        polls[pollId].isActive = false;
        emit PollClosed(pollId, polls[pollId].totalVotes);
    }

    function getPollDetails(string calldata pollId) external view returns (
        string memory question,
        uint256 endTime,
        uint32 totalVotes,
        bool isActive
    ) {
        require(bytes(polls[pollId].question).length > 0, "Poll does not exist");
        return (
            polls[pollId].question,
            polls[pollId].endTime,
            polls[pollId].totalVotes,
            polls[pollId].isActive
        );
    }

    function getVote(string calldata pollId, uint256 voteIndex) external view returns (
        euint32 encryptedVote,
        address voter,
        uint256 timestamp,
        uint32 decryptedVote,
        bool isVerified
    ) {
        require(bytes(polls[pollId].question).length > 0, "Poll does not exist");
        require(voteIndex < pollVotes[pollId].length, "Invalid vote index");
        Vote memory vote = pollVotes[pollId][voteIndex];
        return (
            vote.encryptedVote,
            vote.voter,
            vote.timestamp,
            vote.decryptedVote,
            vote.isVerified
        );
    }

    function getAllPollIds() external view returns (string[] memory) {
        return pollIds;
    }

    function getPollVotes(string calldata pollId) external view returns (Vote[] memory) {
        require(bytes(polls[pollId].question).length > 0, "Poll does not exist");
        return pollVotes[pollId];
    }

    function hasVoted(string calldata pollId, address voter) external view returns (bool) {
        require(bytes(polls[pollId].question).length > 0, "Poll does not exist");
        return polls[pollId].hasVoted[voter];
    }
}

