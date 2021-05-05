import axios from "axios";
import puppeteer from "puppeteer";
import fs from 'fs';
import { createObjectCsvWriter as createCsvWriter } from "csv-writer";

const url = "https://vipp.com/en/api/products?";
const testing = {
  browser: false, // false: headless   | true: visual browser
  links: false     // false: all links  | true: first 5 links
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
    const data = {colorsArray: [], colors: "", details: []};
    // ---------------------------
    // MAIN INFO
    // ---------------------------
    const mainInfoNodes = document.
      getElementsByClassName("product-info__flag")[0]
      .firstElementChild
      .children;
    data.sku = `vipp-${mainInfoNodes[0].innerText}`;
    data.productName = mainInfoNodes[1].innerText;
    data.description = mainInfoNodes[2].innerText;
    data.currency = mainInfoNodes[4].innerText.split(" ")[0];
    data.price = mainInfoNodes[4].innerText.split(" ")[1];
    data.brand = "Vipp";
    data.supplier = "Vipp";
    data.deliveryTime = "usually within 5 business days";
    // ---------------------------
    // DETAILS
    // ---------------------------
    const rowNodes = document
    .getElementById("product-detail")
    .getElementsByClassName("row line");
    for( const rowNode of rowNodes ) {
      const name = rowNode.children[0].innerText;
      const content = rowNode.children[1].innerText;

      switch (name) {
        case "Design" : data.designer = content.split(",")[0]; break;
        case "Dimensions" : {
          if(content.includes("See product illustration above")) break;
          if (content.startsWith("W x H x D:")) {
            const dimArr = content.slice(11).trim().split(" ");
            data.width = dimArr[0];
            data.height = dimArr[2];
            data.depth = dimArr[4];
            data.dimensions = `H: ${dimArr[2]} x W: ${dimArr[0]} x D: ${dimArr[4]} cm`
          } else {
            data.dimensions = content.trim();
          }
          break;
        }
        case "Materials" : {
          data.material = content.replace("View care instructions","").trim();
          const str = content.toLowerCase();
          data.materialFilter = str.includes("wood") ? "wood" :
                                str.includes("glass") ? "glass" :
                                str.includes("leather") ? "leather" :
                                str.includes("porcelain") ? "porcelain" :
                                str.includes("steel") ? "steel" : "";
          break;
        }
        case "Volume" : {
          data.details.push({name,content});
          break;
        }
        default: data.details.push({name,content}); break;
      }
    }
    // ---------------------------
    // COLORS
    // ---------------------------
    const availableColors = document.getElementsByClassName("dropdown-list")[0]?.children;
    if(availableColors !== undefined) {
      for( color of availableColors ) {
        data.colorsArray.push(color.innerText);
        data.colors += color.innerText + ', ';
      }
      data.colors = data.colors.slice(0, -2); 
    } else {
      data.colorsArray.push("-");
    }
    return data;
  })
  // ---------------------------
  // IMAGE LINKS
  // ---------------------------
  productInfo.images = [];
  for( let i = 1; i < productInfo.colorsArray.length+1; i++) {
    if( productInfo.colorsArray.length !== 1 ) { // case of no color options
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
    console.log(`\t[Color ${i}/${productInfo.colorsArray.length}] Image links scraped.`);
  }
    
  return productInfo;
}

console.log("Starting browser");
const browser = await puppeteer.launch( testing.browser ? {
  headless: false,
  slowMo: 250, // 250ms delay
} : {});
const page = await browser.newPage();
page.setDefaultNavigationTimeout(90000);

const allScrapedProducts = [];
try {
  for( let i = 0; i < links.length; i++ ) {
    console.log(`[${i+1}/${links.length}] Scraping: ${links[i]}`);
    const productInfo = await scrapePage(page, links[i]);
    allScrapedProducts.push(productInfo);
  }
} catch (error) {
  console.log(error);
  await browser.close();
  process.exit(1);
}


await browser.close();

// ---------------------------
// DATA PARSING
// ---------------------------

const saveAsJson = (data, filename) => fs.writeFileSync(`${filename}.json`, JSON.stringify(data, null, 4));


saveAsJson(allScrapedProducts, "vippProducts");
console.log("Full data saved to json file");

const csvWriter = createCsvWriter({
  path: 'vippProducts.csv',
  header: [
      {id: 'sku', title: 'sku'},
      {id: 'category', title: 'category'},
      {id: 'brand', title: 'brand'},
      {id: 'supplier', title: 'supplier'},
      {id: 'parentProduct', title: 'parent_product'},
      {id: 'productName', title: 'product_name'},
      {id: 'variantName', title: 'variant_name'},
      {id: 'description', title: 'description'},
      {id: 'price', title: 'price'},
      {id: 'currency', title: 'currency'},
      {id: 'colors', title: 'colors'},
      {id: 'width', title: 'width'},
      {id: 'height', title: 'height'},
      {id: 'depth', title: 'depth'},
      {id: 'weight', title: 'weight'},
      {id: 'designer', title: 'designer'},
      {id: 'awards', title: 'awards'},
      {id: 'material', title: 'material'},
      {id: 'materialFilter', title: 'materialFilter'},
      {id: 'dimensions', title: 'dimensions'},
      {id: 'setter', title: 'setter'},
      {id: 'names', title: 'names'},
      {id: 'attribute_1', title: 'attribute_1'},
      {id: 'attribute_2', title: 'attribute_2'},
      {id: 'attribute_3', title: 'attribute_3'},
      {id: 'deliveryTime', title: 'delivery_time'},
  ]
});

await csvWriter.writeRecords(allScrapedProducts);
console.log("Data saved as csv");

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

console.log("Images saved");
console.log("All done");