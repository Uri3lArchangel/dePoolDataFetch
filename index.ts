// Uniswap V3 Quote Calculator - Final Corrected Version
const { Web3 } = require("web3");

async function getTokenPriceFromCryptoCompare(fsym:string) {
  const response = await fetch(
    `https://min-api.cryptocompare.com/data/price?fsym=${fsym}&tsyms=USD`
  );
  const data = await response.json() as {[key:string]:number};

  return data["USD"];
}

// Uniswap V3 Factory ABI
const FACTORY_ABI = [
  {
    inputs: [
      { internalType: "address", name: "tokenA", type: "address" },
      { internalType: "address", name: "tokenB", type: "address" },
      { internalType: "uint24", name: "fee", type: "uint24" },
    ],
    name: "getPool",
    outputs: [{ internalType: "address", name: "", type: "address" }],
    stateMutability: "view",
    type: "function",
  },
];

// Uniswap V3 Pool ABI
const POOL_ABI = [
  {
    inputs: [],
    name: "liquidity",
    outputs: [{ internalType: "uint128", name: "", type: "uint128" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "slot0",
    outputs: [
      { internalType: "uint160", name: "sqrtPriceX96", type: "uint160" },
      { internalType: "int24", name: "tick", type: "int24" },
      { internalType: "uint16", name: "observationIndex", type: "uint16" },
      {
        internalType: "uint16",
        name: "observationCardinality",
        type: "uint16",
      },
      {
        internalType: "uint16",
        name: "observationCardinalityNext",
        type: "uint16",
      },
      { internalType: "uint8", name: "feeProtocol", type: "uint8" },
      { internalType: "bool", name: "unlocked", type: "bool" },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "token0",
    outputs: [{ internalType: "address", name: "", type: "address" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "token1",
    outputs: [{ internalType: "address", name: "", type: "address" }],
    stateMutability: "view",
    type: "function",
  },
];

// ERC20 ABI
const ERC20_ABI = [
  {
    inputs: [],
    name: "decimals",
    outputs: [{ internalType: "uint8", name: "", type: "uint8" }],
    stateMutability: "view",
    type: "function",
  }, {
    inputs: [],
    name: "symbol",
    outputs: [{ internalType: "string", name: "", type: "string" }],
    stateMutability: "view",
    type: "function",
  }
];

// Constants
const FEE_TIERS = [100, 500, 3000, 10000]; // 0.01%, 0.05%, 0.3%, 1%
const FEE_DENOMINATOR = BigInt(10000);
const Q96 = BigInt(2) ** BigInt(96);

async function findBestPool(
  web3: any,
  tokenA: string,
  tokenB: string,
  X_DEX_FACTORY_ADDRESS: string
) {
  const factory = new web3.eth.Contract(FACTORY_ABI, X_DEX_FACTORY_ADDRESS);
  let bestPool: {
    pool: any;
    fee: number;
    liquidity: bigint;
    address: string;
  } | null = null;

  for (const fee of FEE_TIERS) {
    try {
      const poolAddress = await factory.methods
        .getPool(tokenA, tokenB, fee)
        .call();
      if (poolAddress === "0x0000000000000000000000000000000000000000")
        continue;

      const pool = new web3.eth.Contract(POOL_ABI, poolAddress);
      const liquidity = BigInt(await pool.methods.liquidity().call());

      if (
        liquidity > 0 &&
        (!bestPool || liquidity > bestPool.liquidity)
      ) {
        bestPool = {
          pool,
          fee,
          liquidity,
          address: poolAddress,
        };
      }
    } catch (error:any) {
     throw new Error(`Error checking pool for fee ${fee}:${error.message}` )
    }
  }

  if (!bestPool) throw new Error("No viable pool found for token pair");
  return bestPool;
}

function calculateSpotPrice(sqrtPriceX96:bigint, decimals0:number, decimals1:number, token0IsInput:boolean) {
  const sqrtPrice = Number(sqrtPriceX96) / Number(Q96);
  let price = sqrtPrice * sqrtPrice;

  const decimalAdjustment = 10 ** (decimals0 - decimals1);
  price = price * decimalAdjustment;

  // Invert if token1 is the input
  return token0IsInput ? price : 1 / price;
}

function calculateSwapOutput({
  amountInRaw,
  sqrtPriceX96,
  liquidity,
  fee,
  zeroForOne,
  decimalsIn,
  decimalsOut,
}:{amountInRaw:bigint,sqrtPriceX96:bigint,liquidity:bigint,fee:number,zeroForOne:boolean,decimalsIn:number,decimalsOut:number}) {
  const feeAmount = (amountInRaw * BigInt(fee)) / FEE_DENOMINATOR;
  const amountInAfterFee = amountInRaw - feeAmount;

  let sqrtPNext:bigint|undefined;
  if (zeroForOne) {
    sqrtPNext =
      sqrtPriceX96 +
      (amountInAfterFee * sqrtPriceX96 * sqrtPriceX96) / (liquidity * Q96);
  } else {
    sqrtPNext = sqrtPriceX96 - (amountInAfterFee * Q96) / liquidity;
    if (sqrtPNext < 0) throw new Error("Price underflow");
  }
if(!sqrtPNext){
  throw new Error("sqrtPriceX96 is undefined")
}
  let amountOut:bigint|undefined;
  if (zeroForOne) {
    amountOut =
      (liquidity * Q96 * (sqrtPNext - sqrtPriceX96)) /
      (sqrtPNext * sqrtPriceX96);
  } else {
    amountOut = (liquidity * (sqrtPriceX96 - sqrtPNext)) / Q96;
  }

  const decimalAdjustment = BigInt(10) ** BigInt(decimalsIn - decimalsOut);
  const adjustedAmountOut = amountOut / decimalAdjustment;
  return {
    amountOut: adjustedAmountOut,
    sqrtPNext,
    feeAmount,
    amountInAfterFee,
  };
}

export async function getAmountOut(
  tokenIn:string,
  tokenOut:string,
  amountIn:number,
  X_DEX_FACTORY_ADDRESS:string,
  rpcUrl = "https://evmrpc-testnet.0g.ai"
) {
  const web3 = new Web3(rpcUrl);
  const {
    pool,
    fee,
    liquidity,
    address: poolAddress,
  } = await findBestPool(web3, tokenIn, tokenOut, X_DEX_FACTORY_ADDRESS);

  const [slot0, token0] = await Promise.all([
    pool.methods.slot0().call(),
    pool.methods.token0().call(),
  ]);
  const sqrtPriceX96 = BigInt(slot0.sqrtPriceX96);

  const tokenInContract = new web3.eth.Contract(ERC20_ABI, tokenIn);
  const tokenOutContract = new web3.eth.Contract(ERC20_ABI, tokenOut);
  const [decimalsIn, decimalsOut,inSymbol] = await Promise.all([
    tokenInContract.methods.decimals().call(),
    tokenOutContract.methods.decimals().call(),
    tokenInContract.methods.symbol().call(),


  ]);

  const decimalsInNum = Number(decimalsIn);
  const decimalsOutNum = Number(decimalsOut);

  const amountInRaw = BigInt(Math.floor(amountIn * 10 ** decimalsInNum));
  const zeroForOne = tokenIn.toLowerCase() === token0.toLowerCase();

  const { sqrtPNext } = calculateSwapOutput({
    amountInRaw,
    sqrtPriceX96,
    liquidity,
    fee,
    zeroForOne,
    decimalsIn: decimalsInNum,
    decimalsOut: decimalsOutNum,
  });

  const spotPrice = calculateSpotPrice(
    slot0.sqrtPriceX96,
    zeroForOne ? decimalsInNum : decimalsOutNum,
    zeroForOne ? decimalsOutNum : decimalsInNum,
    zeroForOne
  );
  const usdPricePerToken =await getTokenPriceFromCryptoCompare(inSymbol)
  const usdPrice = usdPricePerToken*amountIn
  return {
    price: spotPrice,
    amountIn: amountIn,
    poolAddress,
    usdPrice,
    fee: fee,
    sqrtPriceStart: sqrtPriceX96.toString(),
    sqrtPriceNext: sqrtPNext.toString(),
    liquidity: liquidity.toString(),
    tokenInDecimals: decimalsInNum,
    tokenOutDecimals: decimalsOutNum,
    zeroForOne,
  };
}

