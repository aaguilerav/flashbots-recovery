import { BigNumber } from "ethers";
import { Block } from "@ethersproject/abstract-provider";

export interface GasEstimates {
    estimates: BigNumber[],
    estimateTotal: BigNumber
    price: BigNumber,
    block: Block
}