import axios from "axios";
import puppeteer from "puppeteer";
const url = "https://vipp.com/en/api/products?";
// Flag for testing ( True: 22 products, False: all of them ).
const testing = false;

// //const reqLimit = testing ? 1 : 150;
// const reqLimit = 1;

// let links = [];
// const promises = [];

// for (let i = 0; i < reqLimit; i+=22) {
//   promises.push(axios.get(`${url}start=${i}&amount=${22}`));
// }
// try {
//   for ( const el of await Promise.all(promises) ) {
//     links.push(...el.data.products);
//   }
// } catch (error) {
//   console.error(error.message);
//   console.log("Something went wrong while fetching links from vipp api");
//   process.exit(1);
// }

// links = links.map(el => `https://vipp.com${el.link}`);
// console.log(`Products to scrape: (${links.length}):`);
// links.forEach(el => console.log(el));

// ------------------------------------
// Puppeteer
// ------------------------------------

const scrapePage = async(page, pageLink) => {
  console.warn(`Scraping: ${pageLink}`);
  await page.goto(pageLink);
  
  await page.addStyleTag({ content: "* {scroll-behavior: auto !important;}" });
  // This was difficult to fix. Smooth scrolling *sometimes* prevents clicks on elements

  const productInfo = await page.evaluate(() => {
    const data = {images: [], colors: [], details: []};
    // ---------------------------
    // MAIN INFO
    // ---------------------------
    const mainInfoNodes = document.
      getElementsByClassName("product-info__flag")[0]
      .firstElementChild
      .children;
    data.sku = mainInfoNodes[0].innerText;
    data.name = mainInfoNodes[1].innerText;
    data.description = mainInfoNodes[2].innerText;
    data.price = mainInfoNodes[4].innerText;
    // ---------------------------
    // DETAILS
    // ---------------------------
    const rowNodes = document
    .getElementById("product-detail")
    .getElementsByClassName("row line");
    for( const rowNode of rowNodes ) {
      data.details.push({
        name: rowNode.children[0].innerText,
        data: rowNode.children[1].innerText
      });
    }
    // ---------------------------
    // IMAGES
    // ---------------------------
    //const availableColors = document.getElementsByClassName("dropdown-list")[0].children[0].innerText;
    const availableColors = document.getElementsByClassName("dropdown-list")[0].children;
    for( color of availableColors ) {
      data.colors.push(color.innerText);
    }
    return data;
  })
  productInfo.images2 = [];
  for( let i = 1; i < productInfo.colors.length+1; i++) {
    //await page.waitForTimeout(2000);
    //const hrefElement  = await page.$("label > span");
    //console.warn(hrefElement);
    //await hrefElement.click();
    //await page.waitForSelector("label > span");
    await page.click("label > span");
    console.warn("label clicked");
    //await page.waitForTimeout(5000);
    console.warn("color clicked");
    const colorClick = page.click(`ul.dropdown-list > li:nth-child(${i})`);
    const response = page.waitForResponse(response => response.url() === "https://vipp.com/en/system/ajax" && response.status() === 200 );
    await Promise.all([
      colorClick,
      response
    ]);
    console.warn("color loaded");
    await page.waitForTimeout(1000);

    const newImages = await page.evaluate(() => {
      const images = [];
      for( image of document.querySelectorAll("div.wrapper-img > img") ) {
        images.push(image.getAttribute("src"));
      }
      return images;
    });
    productInfo.images2.push(...newImages);
  }
    
  return productInfo;
}

console.warn("Start");
const browser = await puppeteer.launch( testing ? {
  headless: false,
  slowMo: 250, // 250ms delay
} : {});
const page = await browser.newPage();
const link = 'https://vipp.com/en/products/table-lamp';

console.log( await scrapePage(page, link));

await browser.close();
