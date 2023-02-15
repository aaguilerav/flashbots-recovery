import { Identities } from "./interfaces/Identities";
import { Contracts } from "./interfaces/Contracts";
import { Providers } from "./interfaces/Providers";
import { GasEstimates } from "./interfaces/GasEstimates";
import { 
    Block,
    TransactionRequest
} from "@ethersproject/abstract-provider";
import {
    FlashbotsBundleProvider,
    FlashbotsBundleRawTransaction,
    FlashbotsBundleResolution,
    FlashbotsBundleTransaction
} from "@flashbots/ethers-provider-bundle";
import { 
    BigNumber,
    providers,
    Wallet,
    utils
} from "ethers";
import { 
    Base
} from "./engine/Base";
import { 
    gasPriceToGwei,
    printTransactions 
} from "./utils";
import { TransferERC20 } from "./engine/TransferERC20"
import { WithdrawStake } from "./engine/WithdrawStake";

require("log-timestamp");

// 1 GWEI = 10^9 WEI
const GWEI = BigNumber.from(10).pow(9);
// How many blocks in the future to send the tx
const BLOCKS_IN_FUTURE = parseInt(process.env.MAINNET_BLOCKS_IN_FUTURE || "2", 10);
// POWR ERC20 token address
const POWR_TKN_ADDR = "0x595832F8FC6BF59c85C527fEC3740A1b7a361269";
// POWR Staking contract address
const POWR_STK_ADDR = "0xba33Aa06901B7662e17869f588b77c04fb0Cd872";
// Gas price to use for the tx
const PRIORITY_GAS_PRICE = GWEI.mul(parseInt(process.env.MAINNET_PRIORITY_GAS_PRICE || "0", 10));
// COMPROMISED PRIVATE KEY❗️❗️❗️. Private key for the compromised Ethereum EOA that owns assets that needs to be transferred
const PRIVATE_KEY_EXECUTOR = process.env.MAINNET_PRIVATE_KEY_EXECUTOR || "";
// Private key for an account that has ETH that will be used to fund the miner
const PRIVATE_KEY_SPONSOR = process.env.MAINNET_PRIVATE_KEY_SPONSOR || "";
// Optional param, private key used to sign messages to Flashbots to establish reputation of profitability
const FLASHBOTS_RELAY_SIGNING_KEY = process.env.MAINNET_FLASHBOTS_RELAY_SIGNING_KEY || "";
// Address which will receive the assets
const RECIPIENT = process.env.MAINNET_RECIPIENT || "";
// Infura API key
const INFURA_API_KEY = process.env.MAINNET_INFURA_API_KEY || "";
// Gas limit for the ETH transfer tx
const GAS_LIMIT = BigNumber.from(90000);

if (PRIVATE_KEY_EXECUTOR === "") {console.warn("MAINNET_PRIVATE_KEY_EXECUTOR env var, corresponding to Ethereum EOA with assets to be transferred"); process.exit(1);}
if (PRIVATE_KEY_SPONSOR === "") {console.warn("MAINNET_PRIVATE_KEY_SPONSOR env var not found, corresponding to an Ethereum EOA with ETH to pay miner");process.exit(1);}
if (FLASHBOTS_RELAY_SIGNING_KEY === "") {console.warn("MAINNET_FLASHBOTS_RELAY_SIGNING_KEY env var not found. Please see https://github.com/flashbots/pm/blob/main/guides/flashbots-alpha.md");process.exit(1);}
if (RECIPIENT === "") {console.warn("MAINNET_RECIPIENT env var not found, an address which will receive the assets");process.exit(1);}
if (INFURA_API_KEY === "") {console.warn("MAINNET_INFURA_API_KEY env var not found.");process.exit(1);}

/**
 * 
 * @returns 
 */
const getIdentities = (): Identities => {
    return {
        authSigner: new Wallet(FLASHBOTS_RELAY_SIGNING_KEY),
        compromised: new Wallet(PRIVATE_KEY_EXECUTOR),
        sponsor: new Wallet(PRIVATE_KEY_SPONSOR),
        safeDestination: RECIPIENT
    };
}

/**
 * 
 * @param authSigner 
 * @returns 
 */
const getProviders = async (authSigner: Wallet): Promise<Providers> => {
    // Mainnet network id: 1
    const _infura = new providers.InfuraProvider(1, INFURA_API_KEY);
    const _jsonRpc = new providers.JsonRpcProvider('http://localhost:8545', 1);
    // const _flashbots = await FlashbotsBundleProvider.create(_infura, authSigner);
    const _flashbots = await FlashbotsBundleProvider.create(_jsonRpc, authSigner);
    return {
        infura: _infura,
        jsonRpc: _jsonRpc,
        flashbots: _flashbots
    };
}

/**
 * 
 * @returns 
 */
const getContracts = (): Contracts => {
    return {
        powrERC20: POWR_TKN_ADDR,
        powrStaking: POWR_STK_ADDR
    };
}

/**
 * 
 * @param providers 
 * @param ids 
 * @param contracts 
 * @returns 
 */
const generateSponsoredTxs = async (providers: Providers, ids: Identities, contracts: Contracts): Promise<Array<TransactionRequest>> => {
    const stakeWithdraw: Base = new WithdrawStake(providers.infura, contracts.powrStaking);
    const erc20Transfer: Base = new TransferERC20(providers.infura, ids.compromised.address, ids.safeDestination, contracts.powrERC20, BigNumber.from(10718013000));
    const sponsoredStakeWithdrawTx: Array<TransactionRequest> = await stakeWithdraw.getSponsoredTransactions();
    const sponsoredErc20TransferTx: Array<TransactionRequest> = await erc20Transfer.getSponsoredTransactions();
    console.log(`sponsored stakeWithdraw tx: ${JSON.stringify(sponsoredStakeWithdrawTx)}`);
    console.log(`sponsored erc20transfer tx: ${JSON.stringify(sponsoredErc20TransferTx)}`);
    return sponsoredStakeWithdrawTx.concat(sponsoredErc20TransferTx);
}

/**
 * 
 * @param providers 
 * @param ids 
 * @param sponsoredTxs 
 * @param block 
 * @returns 
 */
const calculateGasEstimates = async (providers: Providers, ids: Identities, sponsoredTxs: Array<TransactionRequest>, block: Block): Promise<GasEstimates> => {
    const gasEstimates = await Promise.all(sponsoredTxs.map(tx =>
        providers.infura.estimateGas({
            ...tx,
            from: tx.from === undefined ? ids.compromised.address : tx.from
        }))
    );
    console.log(`gasEstimates:`);
    console.log(gasEstimates);
    const gasEstimateTotal = gasEstimates.reduce((acc, cur) => acc.add(cur), BigNumber.from(0));
    console.log(`gasEstimateTotal: ${gasEstimateTotal}`);
    const gasPrice = PRIORITY_GAS_PRICE.add(block.baseFeePerGas || 0);
    console.log(`gasPrice: ${gasPrice}`);

    return {
        estimates: gasEstimates,
        estimateTotal: gasEstimateTotal,
        price: gasPrice,
        block: block
    };
}

/**
 * 
 * @param ids 
 * @param gas 
 * @param sponsoredTxs 
 * @returns 
 */
const getBundleOfTxs = async (ids: Identities, gas: GasEstimates, sponsoredTxs: Array<TransactionRequest>): Promise<Array<FlashbotsBundleTransaction | FlashbotsBundleRawTransaction>> => {
    return [
        // Tx for funding the compromised key (executor) with some ETH
        {
            transaction: {
                to: ids.compromised.address,
                value: utils.hexValue(BigNumber.from(`${3 * Number(gas.estimateTotal.mul(gas.price))}`)),
                gasPrice: gas.price,
                gasLimit: GAS_LIMIT,
            },
            signer: ids.sponsor
        },
        // Adding the Txs that are going to withdraw from the staking contract and send the POWR tokens to a safe destination
        ...sponsoredTxs.map((transaction, txNumber) => {
            return {
                transaction: {
                    ...transaction,
                    gasPrice: gas.price,
                    gasLimit: gas.estimates[txNumber],
                },
                signer: ids.compromised,
            }
        })
    ];
}

/**
 * 
 * @param providers 
 * @param ids 
 * @param gas 
 * @param bundleTxs 
 */
const sendBundleOfTxs = async (providers: Providers, ids: Identities, gas: GasEstimates, bundleTxs: Array<FlashbotsBundleTransaction | FlashbotsBundleRawTransaction>): Promise<void> => {

    console.log(`Executor Account: ${ids.compromised.address}`);
    console.log(`Sponsor Account: ${ids.sponsor.address}`);
    console.log(`Gas Price: ${gasPriceToGwei(gas.price)} gwei`);
    console.log(`Gas Used: ${gas.estimateTotal.toString()}`);

    const blockNumber: number = await providers.infura.getBlockNumber();
    const targetBlockNumber = blockNumber + BLOCKS_IN_FUTURE;
    console.log(`Current Block Number: ${blockNumber}, Target Block Number:${targetBlockNumber}`);
    const bundleResponse = await providers.flashbots.sendBundle(bundleTxs, targetBlockNumber);
    if ('error' in bundleResponse) {
        throw new Error(bundleResponse.error.message);
    }

    const bundleResolution = await bundleResponse.wait();
    switch (bundleResolution) {
        case FlashbotsBundleResolution.BundleIncluded:
            console.log(`Congrats, included in ${targetBlockNumber}`);
            console.log(await providers.infura.getBlock(targetBlockNumber)); // Check how to get all the txs in the block
            break;
        case FlashbotsBundleResolution.BlockPassedWithoutInclusion:
            console.log(`Not included in ${targetBlockNumber}`);
            break;
        case FlashbotsBundleResolution.AccountNonceTooHigh:
            console.log("Nonce too high, bailing");
            break;
    }
}

/**
 * Flow of transactions:
 * 1. Fund the 'walletExecutor' with some eth, this wallet is the compromised private key and it is the one that is going to perform the following 2 tx.
 * 2. Withdraw POWR tokens from the StakingContract.
 * 3. Transfer the received POWR tokens to a new non-compromised wallet.
 */
const main = async () => {
    const ids: Identities = getIdentities();
    const providers: Providers = await getProviders(ids.authSigner);
    const sponsoredTxs = await generateSponsoredTxs(providers, ids, getContracts());
    const gas: GasEstimates = await calculateGasEstimates(providers, ids, sponsoredTxs, await providers.infura.getBlock("latest"));
    const bundleTxs: Array<FlashbotsBundleTransaction | FlashbotsBundleRawTransaction> = await getBundleOfTxs(ids, gas, sponsoredTxs);
    const signedBundle: Array<string> = await providers.flashbots.signBundle(bundleTxs);
    await printTransactions(bundleTxs, signedBundle);
    await sendBundleOfTxs(providers, ids, gas, bundleTxs);
}

main().then(
    () => {
        process.exit(0);
    }
).catch(
    error => {
        console.log(error);
        process.exit(1);
    }
);
