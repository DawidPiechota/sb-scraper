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

links = links.map(el => `https://vipp.com${el.link}`).filter(e => e!== 'https://vipp.com/en/products/wool-pillow');
console.log(`Products to scrape: (${links.length}):`);
// One link testing:
// links = ["https://vipp.com/en/products/swivel-chair-w-castors"];
// ------------------------------------
// Puppeteer
// ------------------------------------

const scrapePage = async(page, pageLink) => {
  await page.goto(pageLink, {waitUntil: 'networkidle0'});
  await page.waitForTimeout(500);
  
  await page.addStyleTag({ content: "* {scroll-behavior: auto !important;}" });
  // This was difficult to fix. Smooth scrolling *sometimes* prevents clicks on elements

  const shippingInfo = {};

  // ---------------------------
  // SHIPPING
  // ---------------------------
  const outOfStock = await page.evaluate(() => {
    return !!document.querySelector("#edit-out-of-stock");
  })
  if(!outOfStock) {
    await page.waitForTimeout(1000);
    await page.evaluate(() => {
      document.querySelector("form[id^=commerce-cart-add-to-cart]").submit();
    });
    await page.waitForTimeout(500);

    await page.waitForSelector("#number-item-in-cart");

    // go to cart
    // document.querySelector("img.basket-icn.basket-icn--black").click()
    // wait for navigation
    await Promise.all([
      page.click("img.basket-icn.basket-icn--black"),
      page.waitForNavigation() // I think it breaks nonheadless browser
    ]);

    await page.addStyleTag({ content: "* {scroll-behavior: auto !important;}" });
    
    // Get shipping info
    shippingInfo.deliveryTime = await page.evaluate(() => {
      return document.querySelector("div.shipping-select > div > p").innerText.trim();
    });

    // go to checkout document.querySelector("#add-to-cart > input").click();
    // wait for navigation
    await Promise.all([
      page.click("#add-to-cart > input"),
      page.waitForNavigation()
    ]);

    await page.waitForTimeout(1000);
    await page.addStyleTag({ content: "* {scroll-behavior: auto !important;}" });

    shippingInfo.fastTrack = await page.evaluate(() => {
      return [...document.getElementsByClassName("option")]
        .map(el => el.innerText.toLowerCase().includes("express"))
        .reduce((acc, el) => el === true ? true : acc, false);
    });
    
    
    // go back
    // wait for navigation
    await page.goBack();
    //await page.waitForTimeout(100000);
    await page.addStyleTag({ content: "* {scroll-behavior: auto !important;}" });
    // delete item from cart document.querySelector("#edit-edit-delete-0").submit();
    // document.querySelector("span.commerce-quantity-plusminus-link.commerce-quantity-plusminus-link-decrease.minus.commerce-quantity-plusminus-link-disabled > a").click()
    //dupaaaa await page.waitForTimeout(1000);
    //await page.click("span.commerce-quantity-plusminus-link.commerce-quantity-plusminus-link-decrease.minus > a");
    await page.click("#edit-edit-delete-0");
    //dupaaaa await page.waitForTimeout(1000);
    await page.waitForTimeout(500);
    await page.goBack();
    await page.addStyleTag({ content: "* {scroll-behavior: auto !important;}" });
  }
  
  const productInfo = await page.evaluate(() => {
    const data = {colorsArray: [], colors: "", details: []};
    // ---------------------------
    // MAIN INFO
    // ---------------------------
    const mainInfoNodes = document.
      getElementsByClassName("product-info__flag")[0]
      .firstElementChild
      .children;
    data.sku = `vipp-${mainInfoNodes[0].innerText.replaceAll('/','-').replaceAll(' ','-').replaceAll(',','').toLowerCase().replaceAll('vipp', '')}`;
    data.productId = `vipp-${document.querySelector('input[name=product_id]')?.value || document.querySelector('select[name=product_id] > option[selected]')?.value}`;
    data.productName = mainInfoNodes[1].innerText;
    data.variantName = mainInfoNodes[1].innerText;
    data.description = mainInfoNodes[2].innerText;
    data.currency = mainInfoNodes[4].innerText.split(" ")[0];
    data.price = mainInfoNodes[4].innerText.split(" ")[1].replaceAll(',','');
    data.brand = "Vipp";
    data.supplier = "Vipp";
    //data.deliveryTime = "usually within 5 business days";
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
          const dimArr = content.slice(11).trim().split(" ");
          if (content.startsWith("W x H x D:")) {
            data.width = dimArr[0];
            data.height = dimArr[2];
            data.depth = dimArr[4];
            data.dimensions = `H: ${dimArr[2]} x W: ${dimArr[0]} x D: ${dimArr[4]} cm`
          }else if (content.startsWith("W x D x H:")) {
            data.width = dimArr[0];
            data.height = dimArr[4];
            data.depth = dimArr[2];
            data.dimensions = `H: ${dimArr[4]} x W: ${dimArr[0]} x D: ${dimArr[2]} cm`
          }else if (content.startsWith("H x D x W:")) {
            data.width = dimArr[4];
            data.height = dimArr[0];
            data.depth = dimArr[2];
            data.dimensions = `H: ${dimArr[0]} x W: ${dimArr[4]} x D: ${dimArr[2]} cm`
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
        let colorTrimmed = color.innerText.slice().replaceAll('/','|');
        if(colorTrimmed.endsWith("(OUT OF STOCK)")) {
          colorTrimmed = colorTrimmed.slice(0,-14).trim();
        }
        data.colorsArray.push(colorTrimmed);
        data.colors += colorTrimmed + ', ';
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
      for( const image of document.querySelectorAll("div.wrapper-img > img") ) {
        images.push({
          src: image.getAttribute("src"),
          type: "packshot"
        });
      }
      images.push({
        src: document.querySelector("div.full.slide-to-top img").getAttribute("src"),
        type: "lifestyle",
      });
      return images;
    });

    const parsedImages = newImages.map(image => {
      if(image.type === "lifestyle"){
        return ({
          src: image.src,
          filename: productInfo.colorsArray[i-1] !== '-' ?
          `${productInfo.sku}-${productInfo.colorsArray[i-1].toLowerCase().replaceAll(' ','-')}-lifestyle` :
            `${productInfo.sku}-lifestyle`,
          betterFilename: productInfo.colorsArray[i-1] !== '-' ?
          `${productInfo.productId}-${productInfo.colorsArray[i-1].toLowerCase().replaceAll(' ','-')}-lifestyle` :
            `${productInfo.productId}-lifestyle`,
        })
      } else {
        return ({
          src: image.src,
          filename: productInfo.colorsArray[i-1] !== '-' ?
          `${productInfo.sku}-${productInfo.colorsArray[i-1].toLowerCase().replaceAll(' ','-')}` :
            productInfo.sku,
          betterFilename: productInfo.colorsArray[i-1] !== '-' ?
          `${productInfo.productId}-${productInfo.colorsArray[i-1].toLowerCase().replaceAll(' ','-')}` :
            productInfo.productId,
        })
      }
      });
    productInfo.images.push(...parsedImages);
    console.log(`\t[Color ${i}/${productInfo.colorsArray.length}] Image links scraped.`);
  }

  return {...productInfo, ...shippingInfo, ...{pageLink: pageLink}};
}

console.log("Starting browser");
const browser = await puppeteer.launch( testing.browser ? {
  headless: false,
  slowMo: 250, // 250ms delay
} : {});
const page = await browser.newPage();
// page.setDefaultNavigationTimeout(90000);

console.log("Setting currency to NOK");
await page.goto("https://vipp.com/en", {waitUntil: 'networkidle0'});
await page.waitForTimeout(3_000);
await page.addStyleTag({ content: "* {scroll-behavior: auto !important;}" });
await page.click('#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll');
await page.waitForTimeout(3_000);
await page.click("a.btn-menu-burger");
try {
  await page.click("a:nth-child(2) > span.dropdown");
} catch (error) {
  await page.waitForTimeout(1500)
  await page.click("body > div.tray-menu > ul.main.menu-level.menu-current.menu-in > li:nth-child(6) > ul > li:nth-child(2) > a");
}
try {
  await page.click("#country_popup > div.popup-box.list-country > div.popup-content > div > ul > li:nth-child(13)");
} catch (error) {
  await page.waitForTimeout(1500)
  await page.click("body > div.tray-menu > ul.tray-menu--submenu.menu-level.submenu-4.menu-in > div > ul > li:nth-child(13) > a");
}

await page.waitForTimeout(3_000);

let allScrapedProducts = [];
try {
  for( let i = 0; i < links.length; i++ ) {
    console.log(`[${i+1}/${links.length}] Scraping: ${links[i]}`);
    const productInfo = await scrapePage(page, links[i]);
    allScrapedProducts.push(productInfo);
  }
} catch (error) {
  console.log(error);
  console.log("closing browser");
  await browser.close();
  process.exit(1);
}

console.log("closing browser");
await browser.close();

// ---------------------------
// DATA PARSING
// ---------------------------
const parseProductsToColorVariants = (products) => {
  const newProducts = [];
  for ( const product of products ) {
    for( const color of product.colorsArray ) {
      if(color === '-') {
        const pcpy = {...product};
        pcpy.colors = "";
        newProducts.push(pcpy);
      } else {
        const pcpy = {...product};
        pcpy.setter = "attribute_1";
        pcpy.names = "Color";
        pcpy.attribute_1 = color;
        pcpy.colors = color;
        pcpy.sku += `-${color.toLowerCase().replaceAll(' ','-')}`;
        pcpy.variantName += ` ${color}`
        newProducts.push(pcpy);
      }
    }
  }
  return newProducts;
}

allScrapedProducts = parseProductsToColorVariants(allScrapedProducts);
// ---------------------------
// DATA SAVING
// ---------------------------
const saveAsJson = (data, filename) => fs.writeFileSync(`${filename}.json`, JSON.stringify(data, null, 4));


saveAsJson(allScrapedProducts, "vippProducts");
console.log("Full data saved to json file");

const csvWriter = createCsvWriter({
  path: 'vippProducts.csv',
  header: [
      {id: 'sku', title: 'sku'},
      {id: 'productId', title: 'product_id'},
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
      {id: 'materialFilter', title: 'material_filter'},
      {id: 'dimensions', title: 'dimensions'},
      {id: 'setter', title: 'setter'},
      {id: 'names', title: 'names'},
      {id: 'attribute_1', title: 'attribute_1'},
      {id: 'attribute_2', title: 'attribute_2'},
      {id: 'attribute_3', title: 'attribute_3'},
      {id: 'deliveryTime', title: 'deliveryTime'},
      {id: 'fastTrack', title: 'fastTrack'},
      {id: 'pageLink', title: 'pageLink'},
  ]
});

await csvWriter.writeRecords(allScrapedProducts);
console.log("Data saved as csv");

// ---------------------------
// IMAGES
// ---------------------------

async function downloadImages(imageArray, imgDir) {
  let count = 1;
  let previousFilename = '';
  for (const image of imageArray) {
    const response = await axios.get(image.src,{
      responseType: 'arraybuffer'
    })
    if(previousFilename === image.filename) {
      fs.writeFileSync(`./${imgDir}/${image.filename}_${count}.jpg`, response.data);
      count++;
    } else {
      fs.writeFileSync(`./${imgDir}/${image.filename}.jpg`, response.data);
      count = 1;
    }
    previousFilename = image.filename;
    console.log(`\tDownloaded ${image.filename} from ${image.src}`);
  }
}

const imgDir = './images';
if (!fs.existsSync(imgDir)){
    fs.mkdirSync(imgDir);
}

for(let i = 0; i < allScrapedProducts.length; i++) {
  console.log(`[${i+1}/${allScrapedProducts.length}] Downloading images of: ${allScrapedProducts[i].sku}`);
  await downloadImages(allScrapedProducts[i].images, imgDir);
}

console.log("Images saved");
console.log("All done");