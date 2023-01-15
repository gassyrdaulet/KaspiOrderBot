import mysql from "mysql2/promise";
import config from "./config/config.json" assert { type: "json" };

const { dataBaseConfig } = config;

export default mysql.createPool(dataBaseConfig);
