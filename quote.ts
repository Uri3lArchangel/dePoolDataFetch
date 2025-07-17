const { ethers } = require("ethers");

const RPC = "https://evmrpc-testnet.0g.ai";
const quoterAddress = "0x8d5E064d2EF44C29eE349e71CF70F751ECD62892";

const run = async (tokenIn:string, tokenOut:string, amountIn:string, fee:number,sqrtPriceLimitX96="0") => {
  const provider = new ethers.JsonRpcProvider(RPC);

  const viewABI = [
    {
      inputs: [
        { internalType: "address", name: "tokenIn", type: "address" },
        { internalType: "address", name: "tokenOut", type: "address" },
        { internalType: "uint24", name: "fee", type: "uint24" },
        { internalType: "uint256", name: "amountIn", type: "uint256" },
        { internalType: "uint160", name: "sqrtPriceLimitX96", type: "uint160" },
      ],
      name: "quoteExactInputSingle",
      outputs: [{ internalType: "uint256", name: "amountOut", type: "uint256" }],
      stateMutability: "view",
      type: "function",
    },
  ];

  const quoter = new ethers.Contract(quoterAddress, viewABI, provider);

  try {
    const amountOut = await quoter.quoteExactInputSingle(
      tokenIn,
      tokenOut,
      fee,
      amountIn,
      sqrtPriceLimitX96
    );

    console.log("Amount Out:", amountOut.toString());
    return amountOut.toString();
  } catch (err:any) {
    console.error("Quote failed:", err);
  }
};

run(
  "0x36f6414FF1df609214dDAbA71c84f18bcf00F67d",
  "0x3eC8A8705bE1D5ca90066b37ba62c4183B024ebf",
  "1000000000000000000",
  3000
);
