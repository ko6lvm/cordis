const puppeteer = require('puppeteer');

(async () => {
  const browser = await puppeteer.launch({ headless: 'new' });
  const page = await browser.newPage();
  
  await page.goto('http://localhost:5173/');
  await new Promise(r => setTimeout(r, 2000));
  
  try {
    await page.type('input[placeholder="Username"]', 'testuser');
    await page.type('input[placeholder="Password"]', 'test1234');
    const buttons = await page.$$('button');
    for (let b of buttons) {
      if ((await page.evaluate(el => el.textContent, b)) === 'Log In') {
        await b.click();
        break;
      }
    }
  } catch(e) {}
  
  // Wait for the textarea to be visible. If it's not, we have to click the server and channel.
  try {
    await page.waitForSelector('textarea.chat-input', { timeout: 3000 });
  } catch(e) {
    // Click first actual server
    const servers = await page.$$('.server-icon');
    if (servers.length > 1) {
      await servers[1].click();
      await new Promise(r => setTimeout(r, 1000));
    }

    // Click first channel
    const channels = await page.$$('.channel-item');
    if (channels.length > 0) {
      await channels[0].click();
      await new Promise(r => setTimeout(r, 1000));
    }
    
    await page.waitForSelector('textarea.chat-input', { timeout: 3000 });
  }

  const beforeDropDisabled = await page.evaluate(() => {
    const ta = document.querySelector('textarea.chat-input');
    return ta ? ta.disabled : null;
  });
  console.log("Textarea disabled before drag:", beforeDropDisabled);

  // Simulate drag and drop
  console.log("Simulating drag and drop...");
  
  await page.evaluate(() => {
    const appLayout = document.querySelector('.app-layout');
    if (!appLayout) return;
    
    // Create a fake file
    const file = new File(['hello'], 'dummy.png', { type: 'image/png' });
    
    // Create a data transfer object
    const dt = new DataTransfer();
    dt.items.add(file);
    
    // Dispatch dragenter
    const dragEnterEvent = new DragEvent('dragenter', {
      bubbles: true,
      cancelable: true,
      dataTransfer: dt
    });
    appLayout.dispatchEvent(dragEnterEvent);
  });
  
  await new Promise(r => setTimeout(r, 1000));
  
  await page.evaluate(() => {
    const overlay = document.querySelector('.app-layout > div[style*="zIndex: 9999"]');
    if (!overlay) return;
    
    const file = new File(['hello'], 'dummy.png', { type: 'image/png' });
    const dt = new DataTransfer();
    dt.items.add(file);
    
    const dropEvent = new DragEvent('drop', {
      bubbles: true,
      cancelable: true,
      dataTransfer: dt
    });
    overlay.dispatchEvent(dropEvent);
  });
  
  await new Promise(r => setTimeout(r, 1000));
  
  // Check if textbar is disabled
  const disabled = await page.evaluate(() => {
    const ta = document.querySelector('textarea.chat-input');
    return ta ? ta.disabled : null;
  });
  console.log("Textarea disabled after drag:", disabled);

  await browser.close();
})();
