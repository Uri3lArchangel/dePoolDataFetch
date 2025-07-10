const { Web3 } = require("web3");
const abi = require("./zer0dexV3Factory.json");

// 171522 is the deployment block height of zerodex factory
const init = async (
  X_DEX_FACTORY_ADDRESS: string,
  fromBlockHeight = "171522",
  rpc = "https://evmrpc-testnet.0g.ai"
) => {
  const web3 = new Web3(rpc);
  const factory = new web3.eth.Contract(abi.abi, X_DEX_FACTORY_ADDRESS);
  const latestblock = String(await web3.eth.getBlockNumber());

  const events = await factory.getPastEvents("PoolCreated", {
    fromBlock: fromBlockHeight,
    toBlock: latestblock,
  });

  const pools = events.map((e: any) => ({
    token0: e.returnValues.token0,
    token1: e.returnValues.token1,
    fee: e.returnValues.fee,
    poolAddress: e.returnValues.pool,
  }));

  return pools;
};
