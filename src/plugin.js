const { plugin, logger, pluginPath, resourcesPath } = require("@eniac/flexdesigner")
const path = require('path')
const screenshot = require('screenshot-desktop')
const { Jimp } = require('jimp')

const tasks = {}

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
            if (tasks[device.serialNumber]) {
                for (let key in tasks[device.serialNumber]) {
                    clearInterval(tasks[device.serialNumber][key])
                }
            }
            delete tasks[device.serialNumber]
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

    // 1. stop all previous tasks
    if (tasks[serialNumber]) {
        for (let key in tasks[serialNumber]) {
            clearInterval(tasks[serialNumber][key])
        }
    }
    else {
        tasks[serialNumber] = {}
    }

    // 2. start new tasks
    for (let key of payload.keys) {
        const interval = parseInt(key.data.interval)
        if (tasks[serialNumber][key.uid]) {
            clearInterval(tasks[serialNumber][key.uid])
        }
        tasks[serialNumber][key.uid] = setInterval(() => {
            syncScreenArea(serialNumber, key)
        }, interval);
    }
})


// Connect to flexdesigner and start the plugin
plugin.start()


async function syncScreenArea(serialNumber, key) {
    try {
        const bounds = key.data.bounds
        const options = {
            format: 'png',
        }
        if (key.data.screenId?.length > 0) {
            options.screen = key.data.screenId
        }
        const imgBuffer = await screenshot(options);

        const image = await Jimp.read(imgBuffer);

        const outputBuffer = await image
            .crop({ 
                x: bounds.x,
                y: bounds.y,
                w: bounds.width, 
                h: bounds.height
            })
            .resize({ w: key.width, h: 60, mode: Jimp.RESIZE_BEZIER})
            .getBuffer('image/png');

        const base64 = `data:image/png;base64,${outputBuffer.toString('base64')}`;
        await plugin.draw(serialNumber, key, 'base64', base64)
    } catch (error) {
        logger.error('syncScreenArea:', error)
        clearInterval(tasks[serialNumber][key.uid])
    }
}