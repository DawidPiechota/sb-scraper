import axios from "axios";
import puppeteer from "puppeteer";
import fs from 'fs';
const url = "https://vipp.com/en/api/products?";
const testing = {
  browser: false, // false: headless   | true: visual browser
  links: true     // false: all links  | true: first 5 links
};

const reqLimit = testing.links ? 1 : 150;
const reqIncrement = testing.links ? 5 : 22;

let links = [];
const promises = [];

for (let i = 0; i < reqLimit; i+=reqIncrement) {
  promises.push(axios.get(`${url}start=${i}&amount=${reqIncrement}`));
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

// ------------------------------------
// Puppeteer
// ------------------------------------

const scrapePage = async(page, pageLink) => {
  await page.goto(pageLink);
  
  await page.addStyleTag({ content: "* {scroll-behavior: auto !important;}" });
  // This was difficult to fix. Smooth scrolling *sometimes* prevents clicks on elements

  const productInfo = await page.evaluate(() => {
    const data = {colors: [], details: []};
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
    // COLORS
    // ---------------------------
    const availableColors = document.getElementsByClassName("dropdown-list")[0]?.children;
    if(availableColors !== undefined) {
      for( color of availableColors ) {
        data.colors.push(color.innerText);
      }
    } else {
      data.colors.push("-");
    }
    return data;
  })
  // ---------------------------
  // IMAGE LINKS
  // ---------------------------
  productInfo.images = [];
  for( let i = 1; i < productInfo.colors.length+1; i++) {
    if( productInfo.colors.length !== 1 ) { // case of no color options
      await page.click("label > span");
      const colorClick = page.click(`ul.dropdown-list > li:nth-child(${i})`);
      const response = page.waitForResponse(response => response.url() === "https://vipp.com/en/system/ajax" && response.status() === 200 );
      await Promise.all([
        colorClick,
        response
      ]);
      await page.waitForTimeout(500);
    }

    const newImages = await page.evaluate(() => {
      const images = [];
      for( image of document.querySelectorAll("div.wrapper-img > img") ) {
        images.push(image.getAttribute("src"));
      }
      return images;
    });
    productInfo.images.push(...newImages);
    console.log(`\t[${i}/${productInfo.colors.length}] Image links scraped.`);
  }
    
  return productInfo;
}

console.log("Starting browser");
const browser = await puppeteer.launch( testing.browser ? {
  headless: false,
  slowMo: 250, // 250ms delay
} : {});
const page = await browser.newPage();
// const link = 'https://vipp.com/en/products/table-lamp';

const allScrapedProducts = [];
for( let i = 0; i < links.length; i++ ) {
  console.log(`[${i+1}/${links.length}] Scraping: ${links[i]}`);
  const productInfo = await scrapePage(page, links[i]);
  allScrapedProducts.push(productInfo);
}
//const productInfo2 =  await scrapePage(page, "https://vipp.com/en/products/pedal-bin-4-l-1-gal");


await browser.close();


// ---------------------------
// IMAGES
// ---------------------------

async function downloadImages(imageArray, productSku, imgDir) {
  for (let i = 0; i < imageArray.length; i++) {
    const response = await axios.get(imageArray[i],{
      responseType: 'arraybuffer'
    })
    fs.writeFile(`./${imgDir}/${productSku}_${i}.jpg`, response.data, () => 
      console.log(`\tDownloaded ${imageArray[i]}`));
  }
}

const imgDir = './images';
if (!fs.existsSync(imgDir)){
    fs.mkdirSync(imgDir);
}

for(let i = 0; i < allScrapedProducts.length; i++) {
  console.log(`[${i+1}/${allScrapedProducts.length}] Downloading images of: ${allScrapedProducts[i].sku}`);
  await downloadImages(allScrapedProducts[i].images, allScrapedProducts[i].sku, imgDir);
}
//await downloadImages(productInfo2.images, "VIPP_XD", imgDir);

// ---------------------------
// DATA PARSING
// ---------------------------

const saveAsJson = (data, filename) => fs.writeFileSync(`${filename}.json`, JSON.stringify(data, null, 4));


saveAsJson(allScrapedProducts, "allScrapedProducts");
//saveAsJson(productInfo2, "data2");