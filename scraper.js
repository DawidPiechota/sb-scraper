import axios from "axios";
const url = "https://vipp.com/en/api/products?";
// Flag for testing ( True: 22 products, False: all of them ).
const testing = true;

const reqLimit = testing ? 1 : 150;
let links = [];
const promises = [];

for (let i = 0; i < reqLimit; i+=22) {
  promises.push(axios.get(`${url}start=${i}&amount=${22}`));
}
try {
  for ( const el of await Promise.all(promises) ) {
    links.push(...el.data.products);
  }
} catch (error) {
  console.error(error.message);
  console.log("Something went wrong while fetching links from vipp api");
  process.exit(1);
}

links = links.map(el => `https://vipp.com${el.link}`);
console.log(`Products to scrape: (${links.length}):`);
links.forEach(el => console.log(el));
