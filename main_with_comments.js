'use strict'; // Строгий режим
var CryptoJS = require("crypto-js"); // Для создания хэшей блоков
var express = require("express"); // Для обработки HTTP-запросов; взаимодействие с блокчейном
var bodyParser = require('body-parser'); // Используется вместе с Express для чтения HTTP POST данных. Он преобразует входящие запросы в удобный для использования формат
var WebSocket = require("ws");// Используется для взаимодействия с другими узлами в сети по протоколу WebSocket
// Установка портов
var http_port = process.env.HTTP_PORT || 3001;
var p2p_port = process.env.P2P_PORT || 6001;
// Peer-to-Peer, это тип сетевой архитектуры, где каждый узел (peer) сети может взаимодействовать напрямую с другими узлами без необходимости проходить через центральный сервер

// Инициализация списка пиров (других узлов в сети)
var initialPeers = process.env.PEERS ? process.env.PEERS.split(',') : [];
var difficulty = 4;

// Класс создания блока
class Block {
    constructor(index, previousHash, timestamp, data, hash, difficulty, nonce) {
    this.index = index;
    this.previousHash = previousHash.toString();
    this.timestamp = timestamp;
    this.data = data;
    this.hash = hash.toString();
    this.difficulty = difficulty; 
    this.nonce = nonce; 
    }
}

// Инициализация пустого массива для хранения подключенных сокетов
var sockets = [];

// Констанции для различных видос сообщений, которые будут передаваться между узлами
var MessageType = {
QUERY_LATEST: 0, // Когда узел хочет запросить последний блок в цепочке от другого узла
QUERY_ALL: 1, // Когда узел хочет запросить полную цепочку блоков от другого узла
RESPONSE_BLOCKCHAIN: 2
};

// Получение генезис-блока
var getGenesisBlock = () => {
    return new Block(0, "0", 1682839690, "RUT-MIIT first block", 
    "8d9d5a7ff4a78042ea6737bf59c772f8ed27ef3c9b576eac1976c91aaf48d2de", 0, 0);
}

// Инициализация блокчейна с генезис-блоком
var blockchain = [getGenesisBlock()];

// Инициализация HTTP-сервера
var initHttpServer = () => {
    var app = express(); // Инициализацию сервера, который будет прослушивать входящие HTTP-запросы
    app.use(bodyParser.json()); // Для преобразования тела запроса в JSON, который легко обрабатывать в JavaScript
    app.get('/blocks', (req, res) => res.send(JSON.stringify(blockchain))); // Получение всех блоков
    app.post('/mineBlock', (req, res) => { // Добавление нового блока
        // var newBlock = generateNextBlock(req.body.data);
        var newBlock = mineBlock(req.body.data); 
        addBlock(newBlock);
        broadcast(responseLatestMsg());
        console.log('block added: ' + JSON.stringify(newBlock));
        res.send();
    });
    // Возвращает список пиров
    app.get('/peers', (req, res) => {
        res.send(sockets.map(s => s._socket.remoteAddress + ':' + 
        s._socket.remotePort));
    });
    // Добавляет нового пира
    app.post('/addPeer', (req, res) => {
        connectToPeers([req.body.peer]);
        res.send();
    });
    // Запуск HTTP-сервера
    app.listen(http_port, () => console.log('Listening http on port: ' + http_port));
};

var mineBlock = (blockData) => {
    var previousBlock = getLatestBlock();
    var nextIndex = previousBlock.index + 1;
    var nonce = 0;
    var nextTimestamp = new Date().getTime() / 1000;
    var nextHash = calculateHash(nextIndex, previousBlock.hash, nextTimestamp, blockData, nonce);
    // Change condition
    while (nextHash.indexOf("31415") == -1){
        nonce++;
        nextTimestamp = new Date().getTime() / 1000;
        nextHash = calculateHash(nextIndex, previousBlock.hash, 
            nextTimestamp, blockData, nonce)
            console.log("\"index\":" + nextIndex 
            +",\"previousHash\":"+previousBlock.hash
            +"\"timestamp\":"+nextTimestamp
            +",\"data\":"+blockData
            +",\x1b[33mhash: " + nextHash 
            + " \x1b[0m," + "\"difficulty\":"+difficulty
            +" \x1b[33mnonce: " + nonce + " \x1b[0m ");
        }
        return new Block(nextIndex, previousBlock.hash, nextTimestamp, blockData, nextHash, difficulty, nonce);
}


// Инициализация P2P-сервера
var initP2PServer = () => {
    var server = new WebSocket.Server({port: p2p_port});
    server.on('connection', ws => initConnection(ws));
    console.log('listening websocket p2p port on: ' + p2p_port);
};

// Инициализация нового подключения (между websocket-сервером и другим узлом)
var initConnection = (ws) => {
    sockets.push(ws); // Добавляем новый сокет в массив сокетов
    initMessageHandler(ws); // Инициализируем обработчик сообщений для каждого нового подключения
    initErrorHandler(ws); // Инициализируем обработчик ошибок для каждого нового подключения
    write(ws, queryChainLengthMsg()); // При подключении нового узла, отправляем ему запрос на получение длины цепочки блоков
};

// Инициализация обработчика сообщений
var initMessageHandler = (ws) => {
    ws.on('message', (data) => { // При получении сообщения
            var message = JSON.parse(data); // Парсим сообщение в JSON
            console.log('Received message' + JSON.stringify(message));
            switch (message.type) { // В зависимости от типа сообщения, выполняем различные действия
                case MessageType.QUERY_LATEST: // Если запрос на последний блок
                    write(ws, responseLatestMsg());
                    break;
                case MessageType.QUERY_ALL: // Если запрос на всю цепочку блоков
                    write(ws, responseChainMsg());
                    break;
                case MessageType.RESPONSE_BLOCKCHAIN: // Если получена цепочка блоков
                    handleBlockchainResponse(message);
                    break;
        }
    });
};

// Инициализация обработчика ошибок
var initErrorHandler = (ws) => {
    var closeConnection = (ws) => { // При закрытии соединения
        console.log('connection failed to peer: ' + ws.url);
        sockets.splice(sockets.indexOf(ws), 1); // Удаляет подключение WebSocker из массива sockets
    };
    ws.on('close', () => closeConnection(ws));
    ws.on('error', () => closeConnection(ws))
};

// Подключение к новым пирам
var connectToPeers = (newPeers) => {
    newPeers.forEach((peer) => {
        var ws = new WebSocket(peer);
        ws.on('open', () => initConnection(ws));
        ws.on('error', () => {
            console.log('connection failed')
        });
    });
};

// Обработка ответа блокчейна (обработка входящего сообщение RESPONSE_BLOCKCHAIN)
var handleBlockchainResponse = (message) => {
    var receivedBlocks = JSON.parse(message.data).sort((b1, b2) => (b1.index -b2.index)); // Получаем цепочку блоков
    var latestBlockReceived = receivedBlocks[receivedBlocks.length - 1]; // Получаем последний блок
    var latestBlockHeld = getLatestBlock(); // Получаем последний блок из нашей локальной цепочки блоков
    if (latestBlockReceived.index > latestBlockHeld.index) { // .index - это номер блока в цепочке блоков
        console.log('blockchain possibly behind. We got: ' +  
        latestBlockHeld.index + ' Peer got: ' + latestBlockReceived.index);
        // Если хеш последнего блока нашей цепочки совпадает с хешем предыдущего блока полученной цепочки
        if (latestBlockHeld.hash === latestBlockReceived.previousHash) {
            console.log("We can append the received block to our chain");
            blockchain.push(latestBlockReceived);
            broadcast(responseLatestMsg());
        } else if (receivedBlocks.length === 1) { // Если получен новый блок от пира, но он не является продолжением нашей цепочки
            console.log("We have to query the chain from our peer");
            broadcast(queryAllMsg()); // Запрашиваем у пира всю его цепочку блоков
        } else {
            console.log("Received blockchain is longer than current blockchain");
            replaceChain(receivedBlocks);  // Заменяем нашу цепочку на полученную 
        }
    } else {
        console.log('received blockchain is not longer than current blockchain. Do nothing');
    }
};

// Генерация следующего блока
var generateNextBlock = (blockData) => {
    var previousBlock = getLatestBlock(); // Ссылка на последний блок в цепочке
    var nextIndex = previousBlock.index + 1; // Номер следующего блока
    var nextTimestamp = new Date().getTime() / 1000; // Время создания следующего блока
    var nextHash = calculateHash(nextIndex, previousBlock.hash, nextTimestamp, blockData); // Хеш следующего блока из объединения всех его данных
    return new Block(nextIndex, previousBlock.hash, nextTimestamp, blockData, nextHash);
};

// Рассчет хеша для блока
var calculateHashForBlock = (block) => {
    return calculateHash(block.index, block.previousHash, block.timestamp, block.data, block.nonce);
};

// Рассчет хеша
// Change hash func
var calculateHash = (index, previousHash, timestamp, data, nonce) => {
        var one_hash = CryptoJS.SHA256(index+previousHash+timestamp+data+nonce).toString();
        var sec_hash = CryptoJS.MD5(index+previousHash+timestamp+data+nonce).toString();
        var one_hash_half = one_hash.split('').slice(0,one_hash.length/2).join('');
        var sec_hash_half = sec_hash.split('').slice(0,sec_hash.length/2).join('');
        var new_hash = one_hash_half + sec_hash_half;

        return new_hash.toString();
};

// Добавление нового блока в блокчейн
var addBlock = (newBlock) => {
    if (isValidNewBlock(newBlock, getLatestBlock())) {
        blockchain.push(newBlock);
    }
};

// Проверка, является ли новый блок действительным
var isValidNewBlock = (newBlock, previousBlock) => {
    if (previousBlock.index + 1 !== newBlock.index) { // Индекс нового блока должен быть на один больше, чем индекс последнего блока
        console.log('invalid index');
        return false;
    } else if (previousBlock.hash !== newBlock.previousHash) {
        console.log('invalid previoushash');
        return false;
    } else if (calculateHashForBlock(newBlock) !== newBlock.hash) {
        console.log(typeof (newBlock.hash) + ' ' + typeof
        calculateHashForBlock(newBlock));
        console.log('invalid hash: ' + calculateHashForBlock(newBlock) + ' ' + newBlock.hash);
    return false;
    }
    return true;
};

// Замена цепочки блоков
// Если узел получает цепочку блоков от другого узла, и эта цепочка длиннее и действительна
// то узел заменяет свою текущую цепочку на новую
var replaceChain = (newBlocks) => {
    if (isValidChain(newBlocks) && newBlocks.length > blockchain.length) {
        console.log('Received blockchain is valid. Replacing current blockchain with received blockchain');
        blockchain = newBlocks;
        broadcast(responseLatestMsg());
    } else {
        console.log('Received blockchain invalid');
    }
};

// Проверка, является ли цепочка блоков действительной
var isValidChain = (blockchainToValidate) => {
    if (JSON.stringify(blockchainToValidate[0]) !== JSON.stringify(getGenesisBlock())) { // Проверяем, совпадают ли генезис-блоки
        return false;
    } 
    var tempBlocks = [blockchainToValidate[0]]; // Создаем временный массив 
    for (var i = 1; i < blockchainToValidate.length; i++) { // Цикл будет пройден по каждому блоку в проверяемой цепочке, начиная со второго блока
        if (isValidNewBlock(blockchainToValidate[i], tempBlocks[i - 1])) {
            tempBlocks.push(blockchainToValidate[i]); // Если да, добавляем его в массив
        } else {
            return false;
        }
    }
    return true;
};

// Получение последнего блока
var getLatestBlock = () => blockchain[blockchain.length - 1];

// Создание сообщения с запросом на последний блок
var queryChainLengthMsg = () => ({'type': MessageType.QUERY_LATEST});

// Создание сообщения с запросом на весь блокчейн
var queryAllMsg = () => ({'type': MessageType.QUERY_ALL});

// Отправка ответа на запрос всего блокчейна
var responseChainMsg = () =>({
    'type': MessageType.RESPONSE_BLOCKCHAIN, 'data': JSON.stringify(blockchain)
});

// Отправка ответа на запрос последнего блока
var responseLatestMsg = () => ({
    'type': MessageType.RESPONSE_BLOCKCHAIN,
    'data': JSON.stringify([getLatestBlock()])
});

// Функция для записи сообщений (веб-сокет + сообщение)
var write = (ws, message) => ws.send(JSON.stringify(message));

// Функция для рассылки сообщений всем пирам
var broadcast = (message) => sockets.forEach(socket => write(socket, message));

// Инициализация серверов
connectToPeers(initialPeers); // Подключение к другим узлам в сети
initHttpServer(); // Для общения пользователя с блокчейном
initP2PServer(); // Для общения между узлами в блокчейн-сети


