const fs = require("fs");

const filePath = 'src/errorLog.json'

let logjson = JSON.parse(fs.readFileSync(filePath));

const time = Date.now()
const error = "asdjqownhsdi"
let record = {"time": time,"error": error}

logjson.log.push(record)

fs.writeFileSync(filePath, JSON.stringify(logjson));