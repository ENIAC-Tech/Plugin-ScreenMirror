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
    logger.info('Plugin config updated:', payload)

    updateShortcuts()
})

plugin.on('system.shortcut', (payload) => {
    logger.info('Received shortcut:', payload)
    // Force update all screen captures
    forceUpdateAllScreens()
})


/**
 * Called when received message from UI send by this.$fd.sendToBackend
 * @param {object} payload message sent from UI
 */
plugin.on('ui.message', async (payload) => {
    logger.info('Received message from UI:', payload)
    if (payload.action === 'listDisplays') {
        return await screenshot.listDisplays()
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
    logger.info('Device status changed:', devices)
    for (let device of devices) {
        if (device.status === 'disconnected') {
            // Delete all key data for the device
            delete deviceKeys[device.serialNumber]
            
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
    logger.info('Plugin alive:', payload)
    const data = payload.keys
    const serialNumber = payload.serialNumber

    // Initialize or update device key data
    if (!deviceKeys[serialNumber]) {
        deviceKeys[serialNumber] = {}
    }

    // Update device key data
    for (let key of payload.keys) {
        deviceKeys[serialNumber][key.uid] = key
    }

    // Reconfigure all screen capture tasks
    configureScreenTasks()
})

// Configure all screen capture tasks
function configureScreenTasks() {
    // Stop all existing screen tasks
    for (let screenId in screenTasks) {
        clearInterval(screenTasks[screenId].intervalId)
    }
    
    // Initialize screen task mapping
    const screenConfigs = {}
    
    // Iterate through all devices and keys, group by screen ID and find minimum interval for each screen
    for (let serialNumber in deviceKeys) {
        for (let keyUid in deviceKeys[serialNumber]) {
            const key = deviceKeys[serialNumber][keyUid]
            const interval = parseInt(key.data.interval)
            const screenId = key.data.screenId || 'default'
            
            if (!screenConfigs[screenId]) {
                screenConfigs[screenId] = {
                    minInterval: interval,
                    devices: {}
                }
            } else if (interval < screenConfigs[screenId].minInterval) {
                screenConfigs[screenId].minInterval = interval
            }
            
            // Record which devices use this screen
            if (!screenConfigs[screenId].devices[serialNumber]) {
                screenConfigs[screenId].devices[serialNumber] = []
            }
            screenConfigs[screenId].devices[serialNumber].push(keyUid)
        }
    }
    
    // Create a capture task for each screen
    for (let screenId in screenConfigs) {
        const config = screenConfigs[screenId]
        
        screenTasks[screenId] = {
            lastScreenshot: null,
            timestamp: 0,
            intervalId: setInterval(async () => {
                await captureAndProcessScreen(screenId, config.devices)
            }, config.minInterval),
            minInterval: config.minInterval,
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
        
        // Prepare processing tasks for each device and key using this screen
        for (let serialNumber in devices) {
            const keyUids = devices[serialNumber]
            
            for (let keyUid of keyUids) {
                const key = deviceKeys[serialNumber][keyUid]
                if (!key) continue // Prevent processing keys that were deleted
                
                processingTasks.push({
                    serialNumber,
                    key,
                    bounds: key.data.bounds
                })
            }
        }
        
        for (const task of processingTasks) {
            try {
                const { serialNumber, key, bounds } = task
                
                // Crop from original image and resize
                const croppedImage = image.clone()
                    .crop({ 
                        x: bounds.x,
                        y: bounds.y,
                        w: bounds.width, 
                        h: bounds.height
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

plugin.start()

// wait for plugin to be ready
setTimeout(async () => {
    await updateShortcuts()
}, 500);