import axios from "axios";
import config from "./config/config.json" assert { type: "json" };
import conn from "./db.js";
import { customAlphabet } from "nanoid";

const { kaspi_url, store } = config;

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
    // const pickup = await axios.get(kaspi_url + "/shop/api/v2/orders", {
    //   headers: {
    //     "Content-Type": "application/vnd.api+json",
    //     "X-Auth-Token": api_token,
    //   },
    //   params: {
    //     "page[number]": 0,
    //     "page[size]": 100,
    //     "filter[orders][state]": "PICKUP",
    //     "filter[orders][creationDate][$ge]":
    //       Date.now() - 14 * 24 * 60 * 60 * 1000,
    //   },
    // });
    // const filteredPickup = pickup.data.data.filter(
    //   (item) => !item.attributes.isKaspiDelivery
    // );
    return [...delivery.data.data];
  } catch (e) {
    console.log(
      `<${uid}>${name}: Ошибка при получении активных заказов!`,
      e.response?.data?.message ? e.response?.data?.message : e.message
    );
    return [];
  }
};

const getCancelledOrders = async (uid, name, api_token) => {
  try {
    const cancelled = await axios.get(kaspi_url + "/shop/api/v2/orders", {
      headers: {
        "Content-Type": "application/vnd.api+json",
        "X-Auth-Token": api_token,
      },
      params: {
        "page[number]": 0,
        "page[size]": 100,
        "filter[orders][state]": "ARCHIVE",
        "filter[orders][status]": "CANCELLED",
        "filter[orders][creationDate][$ge]":
          Date.now() - 1 * 24 * 60 * 60 * 1000,
      },
    });
    const filteredCancelled = cancelled.data.data.filter(
      (item) => !item.attributes.isKaspiDelivery
    );
    return filteredCancelled;
  } catch (e) {
    console.log(
      `<${uid}>${name}: Ошибка при получении отмененных заказов!`,
      e.response?.data?.message ? e.response?.data?.message : e.message
    );
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
      str += item.quantity + "шт. " + item.goodName + " | ";
    });
    return str;
  } catch (e) {
    console.log(
      `<${uid}>${name}: Ошибка при получении списка товаров!`,
      e.response?.data?.message ? e.response?.data?.message : e.message
    );
  }
};

const fetchOrders = async () => {
  let fetchedOrdersSum = 0;
  let cancelledOrdersSum = 0;
  try {
    console.log(
      `\n\nЗагрузка заказов началась --- ${new Date().toLocaleDateString()} ${new Date().toLocaleTimeString()}\n\n`
    );
    const storeData = (
      await conn.query(
        `SELECT * FROM stores WHERE activated = "true" and uid = "${store}"`
      )
    )[0][0];
    const users = await Promise.all(
      storeData.users.map(async (item) => {
        if (item.kaspi) {
          const userData = (
            await conn.query(`SELECT * FROM users WHERE uid = "${item.uid}"`)
          )[0][0];
          return userData;
        }
      })
    );
    await Promise.all(
      users.map(async (user) => {
        if (!user) {
          return;
        }
        const cancelled = await getCancelledOrders(
          user.uid,
          user.name,
          user.kaspi_token
        );
        for (let item of cancelled) {
          const candidate = (
            await conn.query(
              `SELECT * FROM o_${store} WHERE order_code = ${item.attributes.code}`
            )
          )[0][0];
          if (!candidate) {
            continue;
          }
          if (candidate.is_pickup === "true" || candidate.status === "NEW") {
            await conn.query(
              `DELETE FROM o_${store} WHERE uid = ${candidate.uid}`
            );
            cancelledOrdersSum++;
            continue;
          }
          if (candidate.status === "INDLVR") {
            await conn.query(
              `UPDATE o_${store} SET status = "PRCANC" WHERE uid = ${candidate.uid}`
            );
            cancelledOrdersSum++;
            continue;
          }
        }
        const orders = await getOrders(user.uid, user.name, user.kaspi_token);
        if (orders.length === 0) {
          return;
        }
        for (let item of orders) {
          const candidate = (
            await conn.query(
              `SELECT * FROM o_${store} WHERE order_code = ${item.attributes.code}`
            )
          )[0][0];
          if (candidate) {
            continue;
          }
          const checkForUniqueOrderId = async () => {
            const nanoid = customAlphabet("1234567890", 8);
            const order_uid = nanoid();
            const sql1 = `SELECT id FROM o_${store} WHERE uid = '${order_uid}'`;
            const sql2 = `SELECT id FROM f_${store} WHERE uid = '${order_uid}'`;
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
          await conn.query(`INSERT INTO o_${store} SET ?`, {
            uid,
            goods,
            address: address ? address : "Самовывоз. Косшыгулулы 20.",
            cellphone: "+7" + item.attributes.customer?.cellPhone,
            is_pickup: (item.attributes.state === "PICKUP") + "",
            delivery_price_for_customer: 0,
            delivery_price_for_deliver: 1200,
            sum: item.attributes.totalPrice,
            status: "NEW",
            creation_date: new Date(),
            manager: user.uid,
            is_kaspi: "true",
            order_id: item.id,
            comment: `Дата создания заказа в Kaspi.kz: ${new Date(
              item.attributes.creationDate
            ).toLocaleDateString()} ${new Date(
              item.attributes.creationDate
            ).toLocaleTimeString()} . Создано ботом.`,
            order_code: item.attributes.code,
          });
          fetchedOrdersSum++;
        }
      })
    );
    console.log(
      `\n\nЗагрузка заказов окончена --- ${new Date().toLocaleDateString()} ${new Date().toLocaleTimeString()} \nВыгружено ${fetchedOrdersSum} заказов. \nОтменено ${cancelledOrdersSum} заказов. \n\n`
    );
    conn.end();
  } catch (e) {
    console.log(e);
    console.log(
      `\n\nОшибка загрузки товаров --- ${new Date().toLocaleDateString()} ${new Date().toLocaleTimeString()} \nВыгружено ${fetchedOrdersSum} заказов. \nОтменено ${cancelledOrdersSum} заказов.\n\n`
    );
    conn.end();
  }
};

fetchOrders();
