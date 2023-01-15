import axios from "axios";
import config from "./config/config.json" assert { type: "json" };
import conn from "./db.js";
import { customAlphabet } from "nanoid";

const { updateMinutes, kaspi_url } = config;

const getOrders = async (uid, name, api_token) => {
  try {
    const delivery = await axios.get(kaspi_url + "/shop/api/v2/orders", {
      headers: {
        "Content-Type": "application/vnd.api+json",
        "X-Auth-Token": api_token,
      },
      params: {
        "page[number]": 0,
        "page[size]": 100,
        "filter[orders][state]": "DELIVERY",
        "filter[orders][creationDate][$ge]":
          Date.now() - 14 * 24 * 60 * 60 * 1000,
      },
    });
    const pickup = await axios.get(kaspi_url + "/shop/api/v2/orders", {
      headers: {
        "Content-Type": "application/vnd.api+json",
        "X-Auth-Token": api_token,
      },
      params: {
        "page[number]": 0,
        "page[size]": 100,
        "filter[orders][state]": "PICKUP",
        "filter[orders][creationDate][$ge]":
          Date.now() - 14 * 24 * 60 * 60 * 1000,
      },
    });
    const filteredPickup = pickup.data.data.filter(
      (item) => !item.attributes.isKaspiDelivery
    );
    return [...delivery.data.data, ...filteredPickup];
  } catch (e) {
    console.log(`<${uid}>${name}: Ошибка!`, e.response?.data?.message);
    return [];
  }
};

const getEntries = async (uid, name, api_token, link) => {
  try {
    const { data: result } = await axios.get(link, {
      headers: {
        "Content-Type": "application/vnd.api+json",
        "X-Auth-Token": api_token,
      },
    });
    const array = [];
    await Promise.all(
      result.data.map(async (item) => {
        array.push({
          goodName: (
            await axios.get(item.relationships.product.links.related, {
              headers: {
                "Content-Type": "application/vnd.api+json",
                "X-Auth-Token": api_token,
              },
            })
          ).data.data.attributes.name,
          quantity: item.attributes.quantity,
        });
      })
    );
    let str = "";
    array.forEach((item) => {
      str += item.quantity + "шт. " + item.goodName;
    });
    return str;
  } catch (e) {
    console.log(`<${uid}>${name}: Ошибка!`, e.response?.data?.message);
  }
};

const fetchOrders = async () => {
  let fetchedOrdersSum = 0;
  try {
    console.log(
      `\n\nЗагрузка заказов началась --- ${new Date().toLocaleDateString()} ${new Date().toLocaleTimeString()}\n\n`
    );
    const users = (
      await conn.query(`SELECT * FROM users WHERE verified = "true"`)
    )[0];
    await Promise.all(
      users.map(async (user) => {
        const orders = await getOrders(user.uid, user.name, user.kaspi_token);
        if (orders.length === 0) {
          return;
        }
        for (let item of orders) {
          const candidate = (
            await conn.query(
              `SELECT * FROM orders WHERE order_code = ${item.attributes.code}`
            )
          )[0][0];
          if (candidate) {
            continue;
          }
          const checkForUniqueOrderId = async () => {
            const nanoid = customAlphabet("1234567890", 8);
            const order_uid = nanoid();
            const sql1 = `SELECT id FROM orders WHERE uid = '${order_uid}'`;
            const sql2 = `SELECT id FROM finished_orders WHERE uid = '${order_uid}'`;
            const order_candidate = (await conn.query(sql1))[0][0];
            const finished_order_candidate = (await conn.query(sql2))[0][0];
            if (order_candidate || finished_order_candidate) {
              return await checkForUniqueOrderId();
            } else {
              return order_uid;
            }
          };
          const uid = await checkForUniqueOrderId();
          const goods = await getEntries(
            user.uid,
            user.name,
            user.kaspi_token,
            item.relationships.entries.links.related
          );
          const address = item.attributes.deliveryAddress?.formattedAddress;
          await conn.query(`INSERT INTO orders SET ?`, {
            uid,
            goods,
            address: address ? address : "Самовывоз. Косшыгулулы 20.",
            cellphone: "+7" + item.attributes.customer?.cellPhone,
            is_pickup: (item.attributes.state === "PICKUP") + "",
            delivery_price_for_customer: 0,
            sum: item.attributes.totalPrice,
            status: "NEW",
            creation_date: new Date(item.attributes.creationDate),
            manager: user.uid,
            is_kaspi: "true",
            order_id: item.id,
            comment: "Создано ботом. 🤖",
            order_code: item.attributes.code,
          });
          fetchedOrdersSum++;
        }
      })
    );
    setTimeout(fetchOrders, updateMinutes * 60 * 1000);
    console.log(
      `\n\nЗагрузка заказов окончена --- ${new Date().toLocaleDateString()} ${new Date().toLocaleTimeString()} \nВыгружено ${fetchedOrdersSum} заказов.\nСледующая загрузка через ${updateMinutes} минут...\n\n`
    );
  } catch (e) {
    console.log("\n", e);
    setTimeout(fetchOrders, updateMinutes * 60 * 1000);
    console.log(
      `\n\nОшибка загрузки товаров --- ${new Date().toLocaleDateString()} ${new Date().toLocaleTimeString()} \nВыгружено ${fetchedOrdersSum} заказов.\nСледующая загрузка через ${updateMinutes} минут...\n\n`
    );
  }
};

fetchOrders();
