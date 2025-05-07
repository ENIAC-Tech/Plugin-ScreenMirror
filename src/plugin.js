const { plugin, logger, pluginPath, resourcesPath } = require("@eniac/flexdesigner")
const path = require('path')
const screenshot = require('screenshot-desktop')
const JimpLib = require('jimp')
const Jimp = JimpLib.Jimp || JimpLib.default || JimpLib

// Track all screen capture tasks and caches
const screenTasks = {}
// Store key data by device serial number
const deviceKeys = {}


plugin.on('plugin.config.updated', (payload) => {
    logger.debug('Plugin config updated:', payload)

    updateShortcuts()
})

plugin.on('system.shortcut', (payload) => {
    logger.debug('Received shortcut:', payload)
    // Force update all screen captures
    forceUpdateAllScreens()
})


/**
 * Called when received message from UI send by this.$fd.sendToBackend
 * @param {object} payload message sent from UI
 */
plugin.on('ui.message', async (payload) => {
    logger.debug('Received message from UI:', payload)
    if (payload.action === 'listDisplays') {
        // 1. First use screenshot-desktop to get basic info (id/name)
        const baseList = await screenshot.listDisplays()

        // 2. For macOS, additionally use Electron's screen API to get pixel dimensions and scale factor
        if (process.platform === 'darwin') {
            try {
                const electronDisplays = await plugin.electronAPI('screen.getAllDisplays') || []

                baseList.forEach(disp => {
                    // Try to match by name (label) or array index
                    const match = electronDisplays.find(ed => ed.label === disp.name) || electronDisplays[baseList.indexOf(disp)]

                    if (match && match.bounds) {
                        disp.top    = match.bounds.y
                        disp.left   = match.bounds.x
                        disp.right  = match.bounds.x + match.bounds.width
                        disp.bottom = match.bounds.y + match.bounds.height
                        disp.width  = match.bounds.width
                        disp.height = match.bounds.height
                        disp.dpiScale = match.scaleFactor
                    }
                })
            } catch (err) {
                logger.error('Failed to merge electron display info:', err)
            }
        }

        return baseList
    }
})

/**
 * Called when device status changes
 * @param {object} devices device status data
 * [
 *  {
 *    serialNumber: '',
 *    deviceData: {
 *       platform: '',
 *       profileVersion: '',
 *       firmwareVersion: '',
 *       deviceName: '',
 *       displayName: ''
 *    }
 *  }
 * ]
 */
plugin.on('device.status', (devices) => {
    logger.debug('Device status changed:', devices)
    for (let device of devices) {
        if (device.status === 'disconnected') {
            logger.debug(`Device ${device.serialNumber} disconnected, cleaning up resources`)
            
            // Delete all key data for the device
            delete deviceKeys[device.serialNumber]
            
            // Clean up this device from all screen tasks
            for (let screenId in screenTasks) {
                if (screenTasks[screenId].devices && screenTasks[screenId].devices[device.serialNumber]) {
                    delete screenTasks[screenId].devices[device.serialNumber]
                }
            }
            
            // Check if other devices are still using the same screen
            checkAndCleanupScreenTasks()
        }
    }
})

/**
 * Called when a plugin key is loaded
 * @param {Object} payload alive key data
 */
plugin.on('plugin.alive', (payload) => {
    logger.debug('Plugin alive:', payload)
    const keys = payload.keys || []
    const serialNumber = payload.serialNumber

    // Clear all existing keys for this device first
    if (deviceKeys[serialNumber]) {
        deviceKeys[serialNumber] = {}
    } else {
        deviceKeys[serialNumber] = {}
    }

    // If there are no keys, just clean up and exit
    if (!keys.length) {
        logger.debug(`No keys for device ${serialNumber}, cleaning up tasks`)
        checkAndCleanupScreenTasks()
        return
    }

    // Update device key data
    for (let key of keys) {
        deviceKeys[serialNumber][key.uid] = key
    }

    // Reconfigure all screen capture tasks
    configureScreenTasks()
    
    // Immediately capture and send screenshots for the first time
    sendImmediateScreenshots(serialNumber, keys)
})

// Add a new inactive event handler
plugin.on('plugin.inactive', (payload) => {
    logger.debug('Plugin inactive:', payload)
    const serialNumber = payload.serialNumber
    
    // Clear keys for this device
    if (deviceKeys[serialNumber]) {
        delete deviceKeys[serialNumber]
    }
    
    // Clean up screen tasks
    checkAndCleanupScreenTasks()
})

// Configure all screen capture tasks
function configureScreenTasks() {
    // Stop all existing screen tasks
    for (let screenId in screenTasks) {
        if (screenTasks[screenId].intervalId) {
            clearInterval(screenTasks[screenId].intervalId)
        }
    }
     
    // Clear all screen tasks if no device keys exist
    if (Object.keys(deviceKeys).length === 0) {
        for (let screenId in screenTasks) {
            delete screenTasks[screenId]
        }
        logger.debug('No devices with keys, all screen tasks cleared')
        return
    }
    
    // Initialize screen task mapping
    const screenConfigs = {}
    let hasActiveKeys = false
    
    // Iterate through all devices and keys, group by screen ID and find minimum interval for each screen
    for (let serialNumber in deviceKeys) {
        const deviceKeyCount = Object.keys(deviceKeys[serialNumber]).length
        if (deviceKeyCount === 0) continue
        
        for (let keyUid in deviceKeys[serialNumber]) {
            hasActiveKeys = true
            const key = deviceKeys[serialNumber][keyUid]
            const interval = parseInt(key.data.interval || '0')
            const screenId = key.data.screenId || 'default'
            
            if (!screenConfigs[screenId]) {
                screenConfigs[screenId] = {
                    minInterval: interval,
                    hasAutoUpdate: interval > 0,
                    devices: {}
                }
            } else {
                // 只有当当前按键的间隔 > 0 且小于现有最小间隔时才更新最小间隔
                if (interval > 0 && (interval < screenConfigs[screenId].minInterval || !screenConfigs[screenId].hasAutoUpdate)) {
                    screenConfigs[screenId].minInterval = interval
                    screenConfigs[screenId].hasAutoUpdate = true
                }
            }
            
            // Record which devices use this screen
            if (!screenConfigs[screenId].devices[serialNumber]) {
                screenConfigs[screenId].devices[serialNumber] = []
            }
            screenConfigs[screenId].devices[serialNumber].push(keyUid)
        }
    }
    
    // If no active keys found, clear all screen tasks
    if (!hasActiveKeys) {
        logger.debug('No active keys found, clearing all screen tasks')
        for (let screenId in screenTasks) {
            delete screenTasks[screenId]
        }
        return
    }
    
    // Clear screen tasks that are no longer needed
    for (let screenId in screenTasks) {
        if (!screenConfigs[screenId]) {
            delete screenTasks[screenId]
        }
    }
    
    // Create a capture task for each screen
    for (let screenId in screenConfigs) {
        const config = screenConfigs[screenId]
        
        // Only create tasks for screens with devices and keys
        if (Object.keys(config.devices).length === 0) continue
        
        logger.debug(`Configuring screen ${screenId}, hasAutoUpdate: ${config.hasAutoUpdate}, minInterval: ${config.minInterval}`)
        
        // 创建屏幕任务，但只有在hasAutoUpdate为true时才创建定时器
        screenTasks[screenId] = {
            lastScreenshot: null,
            timestamp: 0,
            intervalId: config.hasAutoUpdate ? setInterval(async () => {
                // Double check if this screen is still needed before capturing
                if (!isScreenInUse(screenId)) {
                    if (screenTasks[screenId].intervalId) {
                        clearInterval(screenTasks[screenId].intervalId)
                    }
                    delete screenTasks[screenId]
                    logger.debug(`Screen ${screenId} no longer in use, stopping capture task`)
                    return
                }
                await captureAndProcessScreen(screenId, config.devices)
            }, config.minInterval) : null,
            minInterval: config.minInterval,
            hasAutoUpdate: config.hasAutoUpdate,
            devices: config.devices
        }
    }
}

// Check and clean up unused screen tasks
function checkAndCleanupScreenTasks() {
    for (let screenId in screenTasks) {
        let isScreenUsed = false
        
        // Check if any device is still using this screen
        for (let serialNumber in deviceKeys) {
            for (let keyUid in deviceKeys[serialNumber]) {
                const key = deviceKeys[serialNumber][keyUid]
                const keyScreenId = key.data.screenId || 'default'
                
                if (keyScreenId === screenId) {
                    isScreenUsed = true
                    break
                }
            }
            if (isScreenUsed) break
        }
        
        // If screen is no longer used, stop and delete its task
        if (!isScreenUsed) {
            clearInterval(screenTasks[screenId].intervalId)
            delete screenTasks[screenId]
        }
    }
}

// Capture and process screen
async function captureAndProcessScreen(screenId, devices) {
    logger.debug(`Capturing and processing screen ${screenId}`, devices)
    // Safety check - verify the screen task still exists
    if (!screenTasks[screenId]) {
        logger.debug(`Screen task for ${screenId} no longer exists, skipping capture`)
        return
    }
    
    try {
        // Capture screen once
        const options = {
            format: 'png',
        }
        
        if (screenId !== 'default') {
            options.screen = screenId
        }
        
        // Capture screen once
        const imgBuffer = await screenshot(options)
        const image = await Jimp.read(imgBuffer)
        
        // Update screen task screenshot cache
        screenTasks[screenId].lastScreenshot = image
        screenTasks[screenId].timestamp = Date.now()
        
        // Collect all tasks to process
        const processingTasks = []
        
        // Safety check - verify 'devices' object exists and is valid
        if (!devices) {
            logger.error(`Invalid devices object for screen ${screenId}`)
            return
        }
        
        // Flag to track if screen configuration changed
        let configChanged = false
        
        // Prepare processing tasks for each device and key using this screen
        for (let serialNumber in devices) {
            // Skip if the device has been disconnected
            if (!deviceKeys[serialNumber]) {
                logger.debug(`Device ${serialNumber} no longer exists, removing from screen task`)
                delete screenTasks[screenId].devices[serialNumber]
                configChanged = true
                continue
            }
            
            const keyUids = devices[serialNumber]
            if (!keyUids || !Array.isArray(keyUids)) {
                logger.error(`Invalid keyUids for device ${serialNumber}, removing from screen task`)
                delete screenTasks[screenId].devices[serialNumber]
                configChanged = true
                continue
            }
            
            // New array to hold valid keys
            const validKeyUids = []
            
            for (let keyUid of keyUids) {
                // Skip if the key no longer exists
                if (!deviceKeys[serialNumber] || !deviceKeys[serialNumber][keyUid]) {
                    logger.debug(`Key ${keyUid} no longer exists for device ${serialNumber}, removing from screen task`)
                    configChanged = true
                    continue
                }
                
                const key = deviceKeys[serialNumber][keyUid]
                if (!key) {
                    logger.debug(`Key data is null for ${keyUid}, removing from screen task`)
                    configChanged = true
                    continue
                }
                
                // This is a valid key, add it to processing tasks and valid keys list
                processingTasks.push({
                    serialNumber,
                    key,
                    bounds: key.data.bounds
                })
                validKeyUids.push(keyUid)
            }
            
            // Update the device's key list with only valid keys
            if (validKeyUids.length !== keyUids.length) {
                if (validKeyUids.length > 0) {
                    screenTasks[screenId].devices[serialNumber] = validKeyUids
                } else {
                    // If no valid keys left, remove the device from this screen
                    delete screenTasks[screenId].devices[serialNumber]
                }
                configChanged = true
            }
        }
        
        // If configuration changed, check if we should clean up screen tasks
        if (configChanged) {
            // Check if the screen still has any devices
            const devicesLeft = Object.keys(screenTasks[screenId].devices).length
            if (devicesLeft === 0) {
                logger.debug(`No devices left for screen ${screenId}, removing screen task`)
                if (screenTasks[screenId].intervalId) {
                    clearInterval(screenTasks[screenId].intervalId)
                }
                delete screenTasks[screenId]
                return
            }
        }
        
        for (const task of processingTasks) {
            try {
                const { serialNumber, key, bounds } = task
                
                // 新增：在裁剪前对 bounds 做健壮性校验，若为 null/undefined 或非数字则退化为整屏截图
                const bx = Number.isFinite(bounds?.x) ? bounds.x : 0
                const by = Number.isFinite(bounds?.y) ? bounds.y : 0
                const bw = Number.isFinite(bounds?.width) && bounds.width > 0 ? bounds.width : image.bitmap.width
                const bh = Number.isFinite(bounds?.height) && bounds.height > 0 ? bounds.height : image.bitmap.height
                
                // Crop from original image and resize
                const croppedImage = image.clone()
                    .crop({ 
                        x: bx,
                        y: by,
                        w: bw, 
                        h: bh
                    })
                    .resize({ w: key.width, h: 60, mode: Jimp.RESIZE_BEZIER})
                
                const outputBuffer = await croppedImage.getBuffer('image/png')
                const base64 = `data:image/png;base64,${outputBuffer.toString('base64')}`
                
                // Send to device
                await plugin.draw(serialNumber, key, 'base64', base64)
            } catch (err) {
                logger.error(`Error processing image for key ${task.key.uid}:`, err)
            }
        }
    } catch (error) {
        logger.error(`Error capturing screen ${screenId}:`, error)
    }
}

async function syncScreenArea(serialNumber, key) {
    const screenId = key.data.screenId || 'default'
    
    // Check if there's a cache for this screen
    if (screenTasks[screenId] && screenTasks[screenId].lastScreenshot) {
        // Use cached screenshot
        processKeyImage(serialNumber, key, screenTasks[screenId].lastScreenshot.clone())
    } else {
        // If no cache, perform a capture
        try {
            const options = {
                format: 'png',
            }
            
            if (screenId !== 'default') {
                options.screen = screenId
            }
            
            const imgBuffer = await screenshot(options)
            const image = await Jimp.read(imgBuffer)
            
            // Process image
            processKeyImage(serialNumber, key, image)
        } catch (error) {
            logger.error(`Error in syncScreenArea for key ${key.uid}:`, error)
        }
    }
}

// Force update all screen captures
async function forceUpdateAllScreens() {
    // Perform a capture for each screen and update all related keys
    for (let screenId in screenTasks) {
        try {
            await captureAndProcessScreen(screenId, screenTasks[screenId].devices)
        } catch (error) {
            logger.error(`Error forcing update of screen ${screenId}:`, error)
        }
    }
}

async function updateShortcuts() {
    const pluginConfig = await plugin.getConfig()

    if (pluginConfig.shortcut?.length > 0) {
        plugin.updateShortcuts([
            {
                shortcut: pluginConfig.shortcut,
                action: 'register'
            }
        ])
    }
}

// New helper function to check if a screen is still in use
function isScreenInUse(screenId) {
    for (let serialNumber in deviceKeys) {
        for (let keyUid in deviceKeys[serialNumber]) {
            const key = deviceKeys[serialNumber][keyUid]
            const keyScreenId = key.data.screenId || 'default'
            
            if (keyScreenId === screenId) {
                return true
            }
        }
    }
    return false;
}

// Helper function to immediately capture and send screenshots when first alive
async function sendImmediateScreenshots(serialNumber, keys) {    
    // Group keys by screenId for efficient capturing
    const screenGroups = {}
    
    for (let key of keys) {
        const screenId = key.data.screenId || 'default'
        if (!screenGroups[screenId]) {
            screenGroups[screenId] = []
        }
        screenGroups[screenId].push(key)
    }
    
    // Capture and process each screen
    for (let screenId in screenGroups) {
        try {
            // Capture screen
            const options = {
                format: 'png',
            }
            
            if (screenId !== 'default') {
                options.screen = screenId
            }
            
            logger.debug(`Immediate capture for screen ${screenId}`)
            const imgBuffer = await screenshot(options)
            const image = await Jimp.read(imgBuffer)
            
            // Store in cache for later use
            if (screenTasks[screenId]) {
                screenTasks[screenId].lastScreenshot = image
                screenTasks[screenId].timestamp = Date.now()
            }
            
            // Process each key that uses this screen
            for (let key of screenGroups[screenId]) {
                try {
                    const bounds = key.data.bounds
                    
                    // 新增：在裁剪前对 bounds 做健壮性校验，若为 null/undefined 或非数字则退化为整屏截图
                    const bx = Number.isFinite(bounds?.x) ? bounds.x : 0
                    const by = Number.isFinite(bounds?.y) ? bounds.y : 0
                    const bw = Number.isFinite(bounds?.width) && bounds.width > 0 ? bounds.width : image.bitmap.width
                    const bh = Number.isFinite(bounds?.height) && bounds.height > 0 ? bounds.height : image.bitmap.height
                    
                    const croppedImage = image.clone()
                        .crop({ 
                            x: bx,
                            y: by,
                            w: bw, 
                            h: bh
                        })
                        .resize({ w: key.width, h: 60, mode: Jimp.RESIZE_BEZIER})
                    
                    const outputBuffer = await croppedImage.getBuffer('image/png')
                    const base64 = `data:image/png;base64,${outputBuffer.toString('base64')}`
                    
                    await plugin.draw(serialNumber, key, 'base64', base64)
                } catch (err) {
                    logger.error(`Error processing immediate image for key ${key.uid}:`, err)
                }
            }
        } catch (error) {
            logger.error(`Error in immediate capture for screen ${screenId}:`, error)
        }
    }
}

plugin.start()

// wait for plugin to be ready
setTimeout(async () => {
    await updateShortcuts()
logger.info('screen.getAllDisplays', await plugin.electronAPI('screen.getAllDisplays'))

}, 500);