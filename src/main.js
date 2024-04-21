const { Console } = require('console')
require('dotenv').config()
const fs = require("fs");

const filePath = 'src/errorLog.json'

const WebsocketStream = require('./websocketStream')
const logger = new Console({ stdout: process.stdout, stderr: process.stderr })
const WebsocketAPI = require('./websocketAPI')
const Spot = require('./spot')

const apiKey = process.env.API_KEY
const apiSecret = process.env.API_SECRET
const client = new Spot(apiKey, apiSecret, { baseURL: 'https://api.binance.com' })

const k_time_gap = 5
const k_time = k_time_gap + 'm'

let isOperated = false

const unit_1_btc_amount = 0.001
const unit_2_btc_amount = unit_1_btc_amount * 2
let history_close_prices = []

let borrow_time = 0

let borrow_btc_amount = 0
let spot_btc_amount = 0
let spot_usdt_amount = 10000

// getHistoryKlines();

// setTimeout(() => run(), 12000)

function getHistoryKlines() {
    const callbacks = {
        open: (client) => {
            logger.debug('Connected with Websocket server1')
            client.klines('BTCFDUSD', k_time, { limit: 185 })
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
            const now_time = Date.now()
            
            // 检查是否拿着现货btc还没有还清btc欠款，且在一小时的最后3分钟内
            if(borrow_btc_amount > 0){
                const minute = (now_time - borrow_time) / 60000 % 60
                if(0 < minute && minute < 59){
                    if(spot_btc_amount > 0){
                        if(!isOperated){
                            console.log("# hand_repay_btc")
                            isOperated = true
                            hand_repay_btc(borrow_btc_amount)
                        }
                    }
                }
            }

            const kline = JSON.parse(data).data.k
            const h_last_close_price = history_close_prices[history_close_prices.length - 1]
            if (h_last_close_price[0] < kline.t) {  // add kline
                if (h_last_close_price[0] + k_time_gap*60000 != kline.t) {
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
        
            makeOrder(r6, r12, r24, kline.c)
            console.log("----------------------------------------------------")
        }
    }
  
    const websocketStreamClient = new WebsocketStream({ logger, callbacks, combinedStreams: true })

    websocketStreamClient.kline('btcfdusd', k_time)
  
    //setTimeout(() => websocketStreamClient.unsubscribe('btcusdt@kline_1m'), 6000)
    //setTimeout(() => websocketStreamClient.disconnect(), 50000)
}

function makeOrder(r6, r12, r24, now_price) {
    if(r6 > r12 && r12 > (r24 + 1)){  // 改成多方向
        console.log("r6 > r12 > r24, long!!")
        
        // 已经拥有现货，不进行额外操作
        if(spot_btc_amount > 0){
            console.log("现>0 PASS")
        }

        // 借款0单位 现货0单位 普通模式买1单位
        else if(spot_btc_amount == 0 && borrow_btc_amount == 0){
            if(!isOperated){
                console.log("借0 现0 普通买1")
                isOperated = true
                buy_btc(unit_1_btc_amount)
            }else{
                console.log("isOperated")
            }
        }

        // 借款1单位 现货0单位 根据借款时长选择模式买2单位
        else if (spot_btc_amount == 0 && borrow_btc_amount == unit_1_btc_amount){
            if(!isOperated){
                const minute = (Date.now() - borrow_time) / 60000 % 60
                // 检查是否在借贷一小时的最后3分钟内，如果是则，采用自动还款的购买btc方式
                if(0 < minute && minute < 59){ // 自动还款模式
                    console.log("借1 现0 还款买2")
                    isOperated = true
                    repay_buy_btc(unit_2_btc_amount)
                } else { // 普通模式
                    console.log("借1 现0 普通买2")
                    isOperated = true
                    buy_btc(unit_2_btc_amount)
                }
            }else{
                console.log("isOperated")
            }
        }

    } else if (r6 < r12 && r12 < (r24 - 1)) {  // 改成空方向
        console.log("r6 < r12 < r24, short!!")

        // 借款1单位 现货0单位，不进行额外操作
        if(borrow_btc_amount == unit_1_btc_amount && spot_btc_amount == 0){
            console.log("借1 现0 PASS")
        }

        // 借款0单位 现货0单位，借款模式卖1单位
        else if( borrow_btc_amount == 0 && spot_btc_amount == 0){
            if(!isOperated){
                console.log("借0 现0 借款卖1")
                isOperated = true
                borrow_sell_btc(unit_1_btc_amount)
            }else{
                console.log("isOperated")
            }
        }

        // 借款0单位 现货1单位，借款模式卖2单位
        else if( borrow_btc_amount == 0 && spot_btc_amount == unit_1_btc_amount){
            if(!isOperated){
                isOperated = true
                console.log("借0 现1 借款卖2")
                borrow_sell_btc(unit_2_btc_amount)
            }else{
                console.log("isOperated")
            }
        }

        // 借款1单位 现货2单位，普通模式卖2单位
        else if( borrow_btc_amount == unit_1_btc_amount && spot_btc_amount == unit_2_btc_amount){
            if(!isOperated){
                isOperated = true
                console.log("借1 现2 普通卖2")
                sell_btc(unit_2_btc_amount)
            }else{
                console.log("isOperated")
            }
        }
    }
    console.log("r6", r6.toFixed(2), "| r12", r12.toFixed(2), "| r24", r24.toFixed(2))
   
    
    console.log("borrow_time",borrow_time)
    let minute = 0
    if(borrow_btc_amount > 0){
        minute = (Date.now() - borrow_time) / 60000 % 60
    }
    console.log("minute", minute)

    console.log("borrow_btc_amount", borrow_btc_amount)

    console.log("spot_btc_amount", spot_btc_amount)

    console.log("price", now_price)
    // console.log("spot_usdt_amount", spot_usdt_amount)
    // const asset_usdt_amount = spot_usdt_amount + (spot_btc_amount * now_price) - (borrow_btc_amount * now_price)
    // console.log("asset_usdt_amount", asset_usdt_amount)
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


// 自动借款模式卖
function borrow_sell_btc(sell_amount) {

    client.newMarginOrder(
        'BTCFDUSD', // symbol
        'SELL',
        'MARKET',
        {
          quantity: sell_amount,
          newOrderRespType: 'RESULT',
          sideEffectType: 'MARGIN_BUY',
          autoRepayAtCancel: true
        }
      ).then(response => {
            const result = response.data
            if(result.status == 'FILLED'){
                isOperated = false
                if(sell_amount > spot_btc_amount){
                    borrow_time = Date.now()
                    borrow_btc_amount += sell_amount - spot_btc_amount
                    spot_btc_amount = 0
                }else{
                    spot_btc_amount -= sell_amount
                }
            }
        })
        .catch(error => {
            isOperated = false
            writeLog(error)
        })
}

// 普通模式买
function buy_btc(buy_amount) {
 
    client.newMarginOrder(
        'BTCFDUSD', // symbol
        'BUY',
        'MARKET',
        {
          quantity: buy_amount,
          newOrderRespType: 'RESULT',
          sideEffectType: 'NO_SIDE_EFFECT',
        }
      ).then(response => {
            const result = response.data
            if(result.status == 'FILLED'){
                isOperated = false
                spot_btc_amount += buy_amount;
            }
        })
        .catch(error => {
            isOperated = false
            writeLog(error)
        })
}

// 普通模式卖
function sell_btc(sell_amount) {

    client.newMarginOrder(
        'BTCFDUSD', // symbol
        'SELL',
        'MARKET',
        {
          quantity: sell_amount,
          newOrderRespType: 'RESULT',
          sideEffectType: 'NO_SIDE_EFFECT',
        }
      ).then(response => {
            const result = response.data
            if(result.status == 'FILLED'){
                isOperated = false
                spot_btc_amount -= sell_amount;
            }
        })
        .catch(error => {
            isOperated = false
            writeLog(error)
        })
}

function repay_buy_btc(buy_amount) {  // 自动还款模式

    client.newMarginOrder(
        'BTCFDUSD', // symbol
        'BUY',
        'MARKET',
        {
          quantity: buy_amount,
          newOrderRespType: 'RESULT',
          sideEffectType: 'AUTO_REPAY',
        }
      ).then(response => {
            const result = response.data
            if(result.status == 'FILLED'){
                isOperated = false
                spot_btc_amount += buy_amount - borrow_btc_amount;
                borrow_time = 0;
                borrow_btc_amount = 0;
            }
        })
        .catch(error => {
            isOperated = false
            writeLog(error)
        })
}

function hand_repay_btc(repay_amount) {

    client.marginRepay(
        'BTC',
        (repay_amount + 0.001)
      ).then(response => {
            isOperated = false
            if(borrow_btc_amount > spot_btc_amount){
                borrow_btc_amount -= spot_btc_amount
                if(borrow_btc_amount == 0){
                    borrow_time = 0
                }
                spot_btc_amount = 0
            }else{
                spot_btc_amount -= borrow_btc_amount
                borrow_btc_amount = 0
                borrow_time = 0
            }
        })
        .catch(error => {
            isOperated = false
            writeLog(error)
        })
}

function writeLog(error) {
    let logjson = JSON.parse(fs.readFileSync(filePath));

    const time = Date.now()
    let record = {"time": time,"error": error}

    logjson.log.push(record)

    fs.writeFileSync(filePath, JSON.stringify(logjson));
}
// buy_btc()

// sell_btc(0.00099)

// hand_repay_btc()
