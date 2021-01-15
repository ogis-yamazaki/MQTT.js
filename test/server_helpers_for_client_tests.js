'use strict'

var MqttServer = require('./server').MqttServer
var MqttSecureServer = require('./server').MqttSecureServer
var debug = require('debug')('TEST:server_helpers')

var path = require('path')
var fs = require('fs')
var KEY = path.join(__dirname, 'helpers', 'tls-key.pem')
var CERT = path.join(__dirname, 'helpers', 'tls-cert.pem')

var http = require('http')
var WebSocket = require('ws')
var MQTTConnection = require('mqtt-connection')

/**
 * This will build the client for the server to use during testing, and set up the
 * server side client based on mqtt-connection for handling MQTT messages.
 * @param {boolean} protocol - protocols: 'mqtt', 'mqtts', 'ws'
 * @param {Function} handler
 */
function serverBuilder (protocol, handler) {
  if (typeof protocol === 'function') {
    handler = protocol
    protocol = 'mqtt'
  }

  var defaultHandler = function (serverClient) {
    serverClient.on('auth', function (packet) {
      var rc = 'reasonCode'
      var connack = {}
      connack[rc] = 0
      serverClient.connack(connack)
    })
    serverClient.on('connect', function (packet) {
      var rc = 'returnCode'
      var connack = {}
      if (serverClient.options && serverClient.options.protocolVersion === 5) {
        rc = 'reasonCode'
        if (packet.clientId === 'invalid') {
          connack[rc] = 128
        } else {
          connack[rc] = 0
        }
      } else {
        if (packet.clientId === 'invalid') {
          connack[rc] = 2
        } else {
          connack[rc] = 0
        }
      }
      if (packet.properties && packet.properties.authenticationMethod) {
        return false
      } else {
        serverClient.connack(connack)
      }
    })

    serverClient.on('publish', function (packet) {
      setImmediate(function () {
        switch (packet.qos) {
          case 0:
            break
          case 1:
            serverClient.puback(packet)
            break
          case 2:
            serverClient.pubrec(packet)
            break
        }
      })
    })

    serverClient.on('pubrel', function (packet) {
      serverClient.pubcomp(packet)
    })

    serverClient.on('pubrec', function (packet) {
      serverClient.pubrel(packet)
    })

    serverClient.on('pubcomp', function () {
      // Nothing to be done
    })

    serverClient.on('subscribe', function (packet) {
      serverClient.suback({
        messageId: packet.messageId,
        granted: packet.subscriptions.map(function (e) {
          return e.qos
        })
      })
    })

    serverClient.on('unsubscribe', function (packet) {
      packet.granted = packet.unsubscriptions.map(function () { return 0 })
      serverClient.unsuback(packet)
    })

    serverClient.on('pingreq', function () {
      serverClient.pingresp()
    })

    serverClient.on('end', function () {
      debug('disconnected from server')
    })
  }

  if (!handler) {
    handler = defaultHandler
  }

  switch (protocol) {
    case 'mqtt':
      return new MqttServer(handler)
    case 'mqtts':
      return new MqttSecureServer({
        key: fs.readFileSync(KEY),
        cert: fs.readFileSync(CERT)
      },
      handler)
    case 'ws':
      var attachWebsocketServer = function (server) {
        var webSocketServer = new WebSocket.Server({server: server, perMessageDeflate: false})

        webSocketServer.on('connection', function (ws) {
          var stream = WebSocket.createWebSocketStream(ws)
          var connection = new MQTTConnection(stream)
          connection.protocol = ws.protocol
          server.emit('client', connection)
          stream.on('error', function () {})
          connection.on('error', function () {})
          connection.on('close', function () {})
        })
      }

      var httpServer = http.createServer()
      attachWebsocketServer(httpServer)
      httpServer.on('client', handler)
      return httpServer
    default:
      return new MqttServer(handler)
  }
}

exports.serverBuilder = serverBuilder
