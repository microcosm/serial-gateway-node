var app = require('express')();
var http = require('http').Server(app);
var io = require('socket.io')(http);
var serialport = require('serialport');
var SerialPort = serialport.SerialPort;

var allAddresses = ['0.0.0.0:3001', '0.0.0.0:3002', '0.0.0.0:3003'];
var gateways = {};
var thisAddress;
var usage = 'Usage: node gateway HTTP_PORT SERIAL_PORT\nTry \'node list\' to get serial port name';

var localSocket = 'local packet';
var gatewaySocket = 'gateway packet';

/* startup */
processArgs();

function processArgs(){
  if(process.argv.length == 3) {
    findAndBeginSerial();
    beginHttp(process.argv[2]);
  } else if(process.argv.length == 4) {
    beginSerial(process.argv[3]);
    beginHttp(process.argv[2]);
  } else {
    exitWithInfo(usage);
  }
}

/* begin serial */
function findAndBeginSerial() {
  serialport.list(function (err, ports) {
    var found = 0;
    var name, port;
    for(var i = 0; i < ports.length; i++) {
      port = ports[i];
      if(port.manufacturer == 'SEGGER') {
        found++;
        name = port.comName;
      }
    }
    found == 1 ? beginSerial(name) : exitWithInfo(usage);
  });
}

function beginSerial(port) {
  log('Opening serial port ' + port);
  serialPort = new SerialPort(port, {
    baudrate: 38400,
    parser: serialport.parsers.readline('\n')
  }, false);

  serialPort.open(function(error) {
    if(error) {
      exitWithInfo('Serial failed to open: ' + error);
    } else {
      serialPort.on('data', function(data) {
        incomingFromSerial(data);
      });
    }
  });
}

/* begin http */
function beginHttp(port) {
  if(isValidPort(port)) {
    log('Opening http port ' + port);
    http.listen(port, function(){
      initAddress();
      initGateways();
      runWebServer();
      runSocketServer();
    });
  } else {
    exitWithInfo(usage);
  }
}

function initAddress() {
  var address = http.address();
  thisAddress = address['address'] + ':' + address['port'];
  log('Serving clients on [' + thisAddress + ']');
}

function initGateways() {
  allAddresses.forEach(function (address) {
    if(address != thisAddress) {
      gateways[address] = require("socket.io-client");
      gateways[address] = gateways[address].connect('http://' + address, { query: 'clientAddress=' + thisAddress });
      log('Listening to gateway [' + address + ']');
    }
  });
}

function runWebServer() {
  app.get('/', function(req, res){
    res.sendFile(__dirname + '/index.html');
  });
}

function runSocketServer() {
  io.on('connection', function(socket){
    log('Client [' + clientAddress(socket) + '] just connected');

    socket.on('disconnect', function(){
      log('Client [' + clientAddress(socket) + '] just disconnected');
    });

    socket.on(localSocket, function(input){
      incomingFromSocket(input, socket);
    });

    socket.on(gatewaySocket, function(input){
      incomingFromGateway(input, socket);
    });
  });
}

/* incoming */
function incomingFromSerial(input) {
  if(hasGatewayJson(input)) {
    var obj = toObject(input);
    var packet = toPacket(obj);
    logIncoming('local mesh node', obj['sender'], obj['receiver'], obj['message']);
    pushToSockets(packet);
    pushToGateways(packet);
    logDone();
  }
}

function incomingFromSocket(packet, socket) {
  logIncoming('socket client', clientAddress(socket), toTargetId(packet), toMessage(packet));
  pushToSockets(packet);
  pushToGateways(packet);
  logDone();
}

function incomingFromGateway(packet, socket) {
  logIncoming('gateway', clientAddress(socket), toTargetId(packet), toMessage(packet));
  pushToSockets(packet);
  logDone();
}

/* outgoing */
function pushToSockets(packet) {
  logOutgoing('websocket clients');
  io.emit(localSocket, packet);
}

function pushToGateways(packet) {
  logOutgoing('gateways');
  for(var address in gateways) {
    gateways[address].emit(gatewaySocket, packet);
  }
}

/* message parsing */
function toObject(input) {
  return JSON.parse(
    input.substring(
      input.indexOf('{ "gateway-message":'),
      input.indexOf('}}') + 2
    )
  )['gateway-message'];
}

function toPacket(obj) {
  return obj['receiver'] + '-' + obj['message'];
}

function toTargetId(packet) {
  return packet.substring(0, packet.indexOf('-'));
}

function toMessage(packet) {
  return packet.substring(packet.indexOf('-')+1);
}

/* logs */
function log(out) {
  var now = new Date();
  console.log(now + ': ' + out);
}

function logDone() {
  log('Done.');
}

function logIncoming(source, sender, target, message) {
  log('Incoming from ' + source + ' [' + sender + '], message \'' + message + '\' for target ' + target);
}

function logOutgoing(dest) {
  log('Pushing to ' + dest + '...');
}

/* utilities */
function isValidPort(input) {
  return !isNaN(input);
}

function clientAddress(socket) {
  return socket.handshake.query.clientAddress;
}

function hasGatewayJson(input) {
  return input.indexOf('{ "gateway-message":') > 1;
}

function exitWithInfo(info) {
  console.log(info);
  process.exit(0);
}