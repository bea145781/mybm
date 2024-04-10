const { Console } = require('console')
const WebsocketStream = require('./websocketStream')
const logger = new Console({ stdout: process.stdout, stderr: process.stderr })
const WebsocketAPI = require('./websocketAPI')

let history_close_prices = []
let close_prices = []
let btc_amount = 0
let usdt_amount = 1000
getHistoryKlines();

//setTimeout(() => console.log(history_close_prices[history_close_prices.length - 1]), 12000)

// setTimeout(() => console.log(calculateRSI(getlist(177),6).slice(-5)), 14000)
// setTimeout(() => console.log(calculateRSI(getlist(177),12).slice(-5)), 14000)
// setTimeout(() => console.log(calculateRSI(getlist(177),24).slice(-5)), 14000)
// setTimeout(() => console.log("r6", calculateRSI2(close_prices,6)), 14000)
// setTimeout(() => console.log("r12", calculateRSI2(close_prices,12)), 15000)
// setTimeout(() => console.log("r24", calculateRSI2(close_prices,24)), 16000)

setTimeout(() => run(), 12000)
//setTimeout(() => console.log(calculateRSI(getlist(30), 6)), 14000)

//console.log(calculateRSI([50,35,47,45,23,41,38], 6))
// const callbacks = {
//     open: () => logger.debug('Connected with Websocket server'),
//     close: () => logger.debug('Disconnected with Websocket server'),
//     message: data => logger.info(data)
// }
  
// const websocketStreamClient = new WebsocketStream({ logger, callbacks, combinedStreams: true })
  
// websocketStreamClient.kline('btcusdt', '1m')
  
// //setTimeout(() => websocketStreamClient.unsubscribe('btcusdt@kline_1m'), 6000)
// setTimeout(() => websocketStreamClient.disconnect(), 12000)

// for(let i = 0, len = klines.length; i < len; i++) {
//     klines[i] = i+1;
// }
// console.log(klines)

// klines.shift()
// klines.push(25)
// console.log(klines)


function getHistoryKlines() {
    const callbacks = {
        open: (client) => {
            logger.debug('Connected with Websocket server1')
            client.klines('BTCUSDT', '1m', { limit: 190 })
        },
        close: () => {
            logger.debug('Disconnected with Websocket server1')
        },
        message: data => {
            const results = JSON.parse(data).result
            for(let i = 0; i < results.length; i++) {
                const result = results[i];
                history_close_prices.push([result[0],result[4]])
            }
        }
    }
    
    const websocketAPIClient = new WebsocketAPI(null, null, { logger, callbacks })
    
    // disconnect after 20 seconds
    setTimeout(() => websocketAPIClient.disconnect(), 10000)
}

function run() {
    const callbacks = {
        open: () => logger.debug('Connected with Websocket server'),
        close: () => logger.debug('Disconnected with Websocket server'),
        message: data => {
            const kline = JSON.parse(data).data.k
            const h_last_close_price = history_close_prices[history_close_prices.length - 1]
            if (h_last_close_price[0] < kline.t) {  // add kline
                if (h_last_close_price[0] + 60000 != kline.t) {
                    throw new Error("miss gap kline");
                }
                history_close_prices.shift();
                history_close_prices.push([kline.t, kline.c])
            } else if (h_last_close_price[0] == kline.t){ // cover kline
                history_close_prices[history_close_prices.length - 1][1] = kline.c
            } else {
                throw new Error("h_last_close_price[0] > kline.t??");
            }

            const last_close_prices = getClosePricelist(180)
            const r6 = calculateRSI2(last_close_prices,6)
            const r12 = calculateRSI2(last_close_prices,12)
            const r24 = calculateRSI2(last_close_prices,24)
            // console.log("r6:", calculateRSI2(last_close_prices,6))
            // console.log("r12:", calculateRSI2(last_close_prices,12))
            // console.log("r24:", calculateRSI2(last_close_prices,24))
            makeOrder(r6, r12, r24, kline.c)
            console.log("------------------------------")
        }
    }
  
    const websocketStreamClient = new WebsocketStream({ logger, callbacks, combinedStreams: true })
  
    websocketStreamClient.kline('btcusdt', '1m')
  
    //setTimeout(() => websocketStreamClient.unsubscribe('btcusdt@kline_1m'), 6000)
    //setTimeout(() => websocketStreamClient.disconnect(), 50000)
}

function makeOrder(r6, r12, r24, now_price) {
    if(r6 > r12 && r12 > r24){  // should long
        if(btc_amount == 0){
            // buy btc
            btc_amount += usdt_amount / now_price
            usdt_amount = 0
        }
    } else if (r6 < r12 && r12 < r24) {  // should short
        if(btc_amount > 0){
            // sell btc
            usdt_amount += btc_amount * now_price
            btc_amount = 0
        }
    }
    console.log("r6",r6)
    console.log("r12",r12)
    console.log("r24",r24)
    console.log("price", now_price)
    console.log("btc_amount", btc_amount)
    console.log("usdt_amount", usdt_amount)
}

function getClosePricelist(period) {
    const listLength = history_close_prices.length;
    if (listLength < period) {
        throw new Error('period error');
    }
    
    let close_list = []
    for(let i = period + 2; i > 0; i--) {
        close_list.push(history_close_prices[listLength - i][1])
    }
    //close_list.pop();
    return close_list;
}
// function calculateRSI() {
//     let rise_sum_6 = 0;
//     let fall_sum_6 = 0;
//     for(let i = 2; i < 8; i++) {
//         const length = klines.length;
//         const chg = klines[length - i][12];
//         if(chg > 0){
//             rise_sum_6 += chg
//             console.log(chg)
//         }else{
//             fall_sum_6 += chg
//             console.log(chg)
//         }
//     }
//     console.log(rise_sum_6 / 6)
//     console.log(fall_sum_6 / 6)
//     const rsi6 = (rise_sum_6 / 6) / ((rise_sum_6 / 6) + ((-fall_sum_6) / 6)) * 100
//     console.log("rsi6:", rsi6)
// }


function calculateRSI(data, period) {
    if (data.length <= period) {
        throw new Error("Data length must be greater than the period");
    }

    let gain = 0;
    let loss = 0;

    // Calculate initial gains and losses
    for (let i = 1; i <= period; i++) {
        const diff = data[i] - data[i - 1];
        if (diff >= 0) {
            gain += diff;
        } else {
            loss -= diff;
        }
    }

    let avgGain = gain / period;
    let avgLoss = loss / period;

    const rsiValues = [];

    for (let i = period; i < data.length; i++) {
        const diff = data[i] - data[i - 1];
        if (diff >= 0) {
            avgGain = (avgGain * (period - 1) + diff) / period;
            avgLoss = (avgLoss * (period - 1)) / period;
        } else {
            avgLoss = (avgLoss * (period - 1) - diff) / period;
            avgGain = (avgGain * (period - 1)) / period;
        }

        const rs = avgGain / avgLoss;
        const rsi = 100 - (100 / (1 + rs));
        rsiValues.push(rsi);
    }

    return rsiValues;
}
 
function calculateRSI2(prices, period = 14) {
    if (prices.length < period) {
      throw new Error('Not enough prices to calculate RSI');
    }
  
    // 计算价格变化
    const changes = [];
    for (let i = 1; i < prices.length; i++) {
      changes.push(prices[i] - prices[i - 1]);
    }
  
    // 计算平均上涨和平均下跌
    let avgGain = 0;
    let avgLoss = 0;
    for (let i = 0; i < period; i++) {
      const change = changes[i];
      if (change > 0) {
        avgGain += change;
      } else {
        avgLoss += Math.abs(change);
      }
    }
    avgGain /= period;
    avgLoss /= period;
  
    // 计算初始 RS 和 RSI
    let rs = avgGain / avgLoss;
    let rsi = 100 - (100 / (1 + rs));
  
    // 计算后续的 RS 和 RSI
    for (let i = period; i < prices.length; i++) {
      const change = changes[i - 1];
  
      if (change > 0) {
        avgGain = ((avgGain * (period - 1)) + change) / period;
        avgLoss = (avgLoss * (period - 1)) / period;
      } else {
        avgGain = (avgGain * (period - 1)) / period;
        avgLoss = ((avgLoss * (period - 1)) + Math.abs(change)) / period;
      }
  
      rs = avgGain / avgLoss;
      rsi = 100 - (100 / (1 + rs));
    }
  
    return rsi;
  }
  

// // 使用示例
// const periods = 14; // RSI的时间周期
// const values = [132.54, 131.45, 130.23, 130.47, 133.72, 134.27, 134.50, 134.80, 135.00, 135.00, 134.80, 134.80, 134.80, 135.00, 135.00, 135.00, 135.00]; // 股票价格数组
// console.log("1",calculateRSI(values, periods))

// console.log("3",calculateRSI2(values, periods))
