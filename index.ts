import { BaseContract, Contract, Signer, Fragment, ethers } from "ethers";
import type { JsonFragment } from "@ethersproject/abi";

import DoppelgangerContract from "./artifacts/contracts/Doppelganger.sol/Doppelganger.json";
import { JsonRpcProvider } from "@ethersproject/providers";

type ABI = string | Array<Fragment | JsonFragment | string>;

////--------------interfaces-----------------////
interface StubInterface {
  returns(...args: any): StubInterface;
  reverts(): StubInterface;
  revertsWithReason(reason: string): StubInterface;
  withArgs(...args: any[]): StubInterface;
}

interface Mock {
  mock: {
    [key in keyof BaseContract["fallback"] | "receive"]: StubInterface;
  };
}
interface CallStactic {
  call(
    contract: Contract,
    functionName: string,
    ...params: any[]
  ): Promise<any>;
  staticcall(
    contract: Contract,
    functionName: string,
    ...params: any[]
  ): Promise<any>;
}
/////------------------------------------------------------////

export type MockContract<T extends BaseContract = BaseContract> = Contract &
  CallStactic &
  Mock;

class Stub implements StubInterface {
  callData: string;
  stubCalls: Array<() => Promise<any>> = [];
  revertSet = false;
  argsSet = false;

  constructor(
    private mockContract: Contract,
    private encoder: ethers.AbiCoder,
    private func: ethers.FunctionFragment
  ) {
    this.callData = func.selector;
  }

  private err(reason: string): never {
    this.stubCalls = [];
    this.revertSet = false;
    this.argsSet = false;
    throw new Error(reason);
  }

  returns(...args: any) {
    if (this.revertSet) this.err("Revert must be the last call");
    if (!this.func.outputs)
      this.err("Cannot mock return values from a void function");
    const encoded = this.encoder.encode(this.func.outputs, args);

    // if there no calls then this is the first call and we need to use mockReturns to override the queue
    if (this.stubCalls.length === 0) {
      this.stubCalls.push(async () => {
        await this.mockContract.__hardhat__mockReturns(this.callData, encoded);
      });
    } else {
      this.stubCalls.push(async () => {
        await this.mockContract.__hardhat__queueReturn(this.callData, encoded);
      });
    }
    return this;
  }

  reverts() {
    if (this.revertSet) this.err("Revert must be the last call");

    // if there no calls then this is the first call and we need to use mockReturns to override the queue
    if (this.stubCalls.length === 0) {
      this.stubCalls.push(async () => {
        await this.mockContract.__hardhat__mockReverts(
          this.callData,
          "Mock revert"
        );
      });
    } else {
      this.stubCalls.push(async () => {
        await this.mockContract.__hardhat__queueRevert(
          this.callData,
          "Mock revert"
        );
      });
    }
    this.revertSet = true;
    return this;
  }

  revertsWithReason(reason: string) {
    if (this.revertSet) this.err("Revert must be the last call");

    // if there no calls then this is the first call and we need to use mockReturns to override the queue
    if (this.stubCalls.length === 0) {
      this.stubCalls.push(async () => {
        await this.mockContract.__hardhat__mockReverts(this.callData, reason);
      });
    } else {
      this.stubCalls.push(async () => {
        await this.mockContract.__hardhat__queueRevert(this.callData, reason);
      });
    }
    this.revertSet = true;
    return this;
  }

  withArgs(...params: any[]) {
    if (this.argsSet) this.err("withArgs can be called only once");
    this.callData = this.mockContract.interface.encodeFunctionData(
      this.func,
      params
    );
    this.argsSet = true;
    return this;
  }

  async then(resolve: () => void, reject: (e: any) => void) {
    for (let i = 0; i < this.stubCalls.length; i++) {
      try {
        await this.stubCalls[i]();
      } catch (e) {
        this.stubCalls = [];
        this.argsSet = false;
        this.revertSet = false;
        reject(e);
        return;
      }
    }

    this.stubCalls = [];
    this.argsSet = false;
    this.revertSet = false;
    resolve();
  }
}

type DeployOptions = {
  address: string;
  override?: boolean;
};

async function deploy(signer: Signer, options?: DeployOptions) {
  if (options) {
    const { address, override } = options;

    let provider: JsonRpcProvider;
    if (
      signer.provider !== null &&
      signer.provider instanceof JsonRpcProvider
    ) {
      provider = signer.provider as JsonRpcProvider;
    } else {
      provider = new JsonRpcProvider();
    }
    if (!override && (await provider.getCode(address)) !== "0x") {
      throw new Error(
        `${address} already contains a contract. ` +
          "If you want to override it, set the override parameter."
      );
    }
    if ((provider as any)._hardhatNetwork) {
      if (
        await provider?.send("hardhat_setCode", [
          address,
          DoppelgangerContract.deployedBytecode,
        ])
      ) {
        return new Contract(address, DoppelgangerContract.abi, signer);
      } else throw new Error(`Couldn't deploy at ${address}`);
    } else {
      if (
        await provider.send("evm_setAccountCode", [
          address,
          DoppelgangerContract.deployedBytecode,
        ])
      ) {
        return new Contract(address, DoppelgangerContract.abi, signer);
      } else throw new Error(`Couldn't deploy at ${address}`);
    }
  }
  const factory = new ethers.ContractFactory(
    DoppelgangerContract.abi,
    DoppelgangerContract.bytecode,
    signer
  );
  const address = (await factory.deploy()).target;
  const getContract = new ethers.Contract(
    address,
    DoppelgangerContract.abi,
    signer
  );
  return getContract;
}

function createMock<T extends BaseContract>(
  abi: ABI,
  mockContractInstance: Contract
): MockContract<T>["mock"] {
  const functions = new ethers.Interface(abi);
  const encoder = new ethers.AbiCoder();
  const fallbacks: ethers.FunctionFragment[] = [];

  functions.forEachFunction((func) => fallbacks.push(func));

  const mockedAbi = Object.values(fallbacks).reduce((acc, func) => {
    const stubbed = new Stub(
      mockContractInstance as MockContract,
      encoder,
      func
    );
    return {
      ...acc,
      [func.name]: stubbed,
      [func.format()]: stubbed,
    };
  }, {} as MockContract<T>["mock"]);

  (mockedAbi as any).receive = {
    returns: () => {
      throw new Error("Receive function return is not implemented.");
    },
    withArgs: () => {
      throw new Error("Receive function return is not implemented.");
    },
    reverts: () =>
      mockContractInstance.__hardhat__receiveReverts("Mock Revert"),
    revertsWithReason: (reason: string) =>
      mockContractInstance.__hardhat__receiveReverts(reason),
  };

  return mockedAbi;
}

export async function deployMockContract<T extends BaseContract = BaseContract>(
  signer: Signer,
  abi: ABI,
  options?: DeployOptions
): Promise<MockContract<T>> {
  const mockContractInstance = await deploy(signer, options);

  const mock = createMock<T>(abi, mockContractInstance);
  const mockedContract = new Contract(
    mockContractInstance.target,
    abi,
    signer
  ) as MockContract<T>;
  mockedContract.mock = mock;

  const encoder = new ethers.AbiCoder();

  mockedContract.staticcall = async (
    contract: Contract,
    functionName: string,
    ...params: any[]
  ) => {
    let func: ethers.FunctionFragment | null =
      contract.interface.getFunction(functionName);
    if (!func) {
      throw new Error(`Unknown function ${functionName}`);
    }
    if (!func.outputs) {
      throw new Error("Cannot staticcall function with no outputs");
    }
    const tx = await contract.populateTransaction(...params);
    const data = tx.data;
    let result;
    const returnValue = await mockContractInstance.__hardhat__staticcall(
      contract.target,
      data
    );
    result = encoder.decode(func.outputs, returnValue);
    if (result.length === 1) {
      result = result[0];
    }
    return result;
  };

  mockedContract.call = async (
    contract: Contract,
    functionName: string,
    ...params: any[]
  ) => {
    const tx = await contract.populateTransaction(...params);
    const data = tx.data;
    return mockContractInstance.__hardhat__call(contract.target, data);
  };

  return mockedContract;
}
