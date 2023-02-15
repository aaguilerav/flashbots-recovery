import { FlashbotsBundleProvider } from "@flashbots/ethers-provider-bundle";
import { providers } from "ethers";

export interface Providers {
    infura: providers.InfuraProvider,
    jsonRpc: providers.JsonRpcProvider,
    flashbots: FlashbotsBundleProvider
}