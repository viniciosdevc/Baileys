const express = require('express')
const qrcode = require('qrcode-terminal')
const pino = require('pino')

const {
	DisconnectReason,
	fetchLatestBaileysVersion,
	makeCacheableSignalKeyStore,
	makeWASocket,
	useMultiFileAuthState,
} = require('./index.ts')

const port = Number(process.env.PORT || 3000)
const logger = pino({ level: process.env.LOG_LEVEL || 'info' })
const app = express()
let reconnectTimer = null
let currentQR = null

app.get('/', (_request, response) => {
	response.status(200).send('Baileys server running')
})

app.get('/health', (_request, response) => {
	response.status(200).json({ status: 'ok' })
})

app.get('/qr', (_request, response) => {
	if (!currentQR) {
		return response.status(404).json({ error: 'No QR code available. Already connected or not started yet.' })
	}
	response.status(200).json({ qr: currentQR })
})

app.listen(port, () => {
	logger.info({ port }, 'HTTP server started')
})

const scheduleReconnect = () => {
	if (reconnectTimer) {
		clearTimeout(reconnectTimer)
	}

	reconnectTimer = setTimeout(() => {
		reconnectTimer = null
		void startBaileys()
	}, 5000)
}

const startBaileys = async () => {
	try {
		const { state, saveCreds } = await useMultiFileAuthState('./auth')
		const { version, isLatest } = await fetchLatestBaileysVersion()

		logger.info({ version, isLatest }, 'Starting Baileys socket')

		const sock = makeWASocket({
			version,
			logger,
			printQRInTerminal: false,
			auth: {
				creds: state.creds,
				keys: makeCacheableSignalKeyStore(state.keys, logger),
			},
		})

		sock.ev.on('creds.update', saveCreds)

		sock.ev.on('connection.update', async (update) => {
			if (update.qr) {
				currentQR = update.qr
				logger.info('QR code generated, fetch at /qr')
				qrcode.generate(update.qr, { small: true })
			}

			if (update.connection === 'open') {
				currentQR = null
				logger.info('Baileys connection opened')
				return
			}

			if (update.connection === 'close') {
				const statusCode = update.lastDisconnect?.error?.output?.statusCode
				logger.warn({ statusCode, error: update.lastDisconnect?.error }, 'Baileys connection closed')

				if (statusCode !== DisconnectReason.loggedOut) {
					logger.info('Scheduling reconnect')
					scheduleReconnect()
					return
				}

				logger.warn('Baileys session logged out, reconnect disabled until auth is recreated')
			}
		})

		return sock
	} catch (error) {
		logger.error({ err: error }, 'Failed to start Baileys')
		scheduleReconnect()
		return null
	}
}

void startBaileys()