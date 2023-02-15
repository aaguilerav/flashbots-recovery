import { Wallet } from "ethers";

export interface Identities {
    authSigner: Wallet,
    compromised: Wallet,
    sponsor: Wallet,
    safeDestination: string
}