import express from "express";
import { createServer } from "http";
import { nanoid } from "nanoid";
import { Server } from "socket.io";

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: "http://localhost:5173" },
});

const cards = [
  "pedra",
  "pedra",
  "pedra",
  "papel",
  "papel",
  "papel",
  "tesoura",
  "tesoura",
  "tesoura",
];

const usersOnRoom = {};
const rooms = {};

io.on("connection", (socket) => {
  console.log("usuario conectado ", socket.id);
  socket.data.isAdmin = false;
  console.log(socket.rooms.size);

  socket.on("login", (username) => {
    const validLogin = validUsername(socket, username);
    if (!validLogin) return false;

    socket.on("createRoom", () => {
      if (socket.data.isAdmin) return handleDisconnectRoom(socket);
      socket.data.isAdmin = true;
      const roomCode = nanoid(5);

      rooms[roomCode] = {
        cardsBackup: [...cards],
        usersCount: 0,
        userPoints: 0,
        oponentPoints: 0,
        cardsSelected: {
          userCard: null,
          oponentCard: null
        }
      };

      socket.emit("roomCreated", roomCode);

      handleEnterRoom(socket, roomCode);

      socket.on("start", () => {
        if (rooms[roomCode].usersCount < 2) {
          return false;
        }
        console.log("start");

        if(rooms[roomCode].cardsBackup.length <= 3) {
          resetCards(roomCode);
          socket.to(roomCode).emit("changeCards", []);
          socket.emit("changeCards", []);
        }

        rooms[roomCode].userCards = chooseCards(roomCode);
        rooms[roomCode].oponentCards = chooseCards(roomCode);

        socket.to(roomCode).emit("changeCards", rooms[roomCode].oponentCards);
        socket.emit("changeCards", rooms[roomCode].userCards);

        socket.on("reset", () => {
          resetCards(roomCode);
          socket.to(roomCode).emit("changeCards", []);
          socket.emit("changeCards", []);
        });
      });
    });

    socket.on("enterRoom", (code) => {
      if (socket.data.isAdmin) return handleDisconnectRoom(socket);
      if (!rooms[code]) {
        socket.emit("connectionError", "Sala invalida!");
        return false;
      }
      if (rooms[code].usersCount === 2) {
        socket.emit("connectionError", "Sala cheia!");
        return false;
      }

      console.log(socket.id, "entrou em: ", code);

      socket.data.isAdmin = false;

      handleEnterRoom(socket, code);
    });
  });
  socket.on("disconnect", () => {
    handleDisconnectRoom(socket);
    console.log("usuario desconectado", socket.id);
  });
});

function handleEnterRoom(socket, roomCode) {
  socket.join(roomCode);

  if (socket.rooms.size > 2) {
    handleDisconnectRoom(socket);
    return;
  }
  const { username, isAdmin } = socket.data;

  usersOnRoom[socket.id] = {
    username: username,
    isAdmin: isAdmin,
    roomCode: roomCode,
    id: socket.id
  };
  const room = rooms[roomCode];

  room.usersCount = (room.usersCount || 0) + 1;
  console.log(rooms);

  io.to(roomCode).emit("usersOnline", getUsersInRoom(roomCode));


  socket.on("selectCard", cardIndex => {
    const { userCards, oponentCards, cardsSelected } = room;

    if ((cardsSelected.userCard && isAdmin) || (cardsSelected.oponentCard && !isAdmin))
      return false;

    const selectedCard = isAdmin ? userCards[cardIndex] : oponentCards[cardIndex]; 
    const remainingCards = isAdmin ? userCards : oponentCards;

    console.log(selectedCard);
    console.log(remainingCards);

    if(isAdmin){
      cardsSelected.userCard = selectedCard;
    } else {
      cardsSelected.oponentCard = selectedCard;
    }

    remainingCards.splice(cardIndex, 1);
    socket.emit("changeCards", remainingCards);
    io.to(roomCode).emit("cardSelected", socket.id);
      
    socket.on("finish_game", () => {
      if(!isAdmin) return false;

      const {userCard, oponentCard} = cardsSelected;

      if(userCard && oponentCard) {
        const result = handleRPS(cardsSelected);
        console.log(result);

        if(result === "empate"){
          room.userPoints += 0;
          room.oponentPoints += 0;
          io.to(roomCode).emit("result_game", {points: getRoomPoints(roomCode), winner: "empate"});
        } else if(result === "oponente"){
          room.oponentPoints += 1;
          io.to(roomCode).emit("result_game", {points: getRoomPoints(roomCode), winner: "oponente"});
        } else if(result === "usuario"){
          room.userPoints += 1;
          io.to(roomCode).emit("result_game", {points: getRoomPoints(roomCode), winner: "usuario"});
        }

        console.log(getRoomPoints(roomCode));

        cardsSelected.userCard = null;
        cardsSelected.oponentCard = null;
      }
    })
  })
}

function handleDisconnectRoom(socket) {
  
  if (usersOnRoom.hasOwnProperty(socket.id)) {
    const { roomCode } = usersOnRoom[socket.id];
    resetCards(roomCode);
    delete usersOnRoom[socket.id];

    io.to(roomCode).emit("disconnect_room");
    io.to(roomCode).emit("usersOnline", getUsersInRoom(roomCode));

    if (rooms[roomCode]) {
      rooms[roomCode].usersCount = (rooms[roomCode].usersCount || 0) - 1;
      if (socket.data.isAdmin) delete rooms[roomCode];
    }
  }

  socket.disconnect();
  return false;
}

function getUsersInRoom(code) {
  return Object.values(usersOnRoom)
    .filter((user) => user.roomCode === code)
    .map(({id, username, isAdmin }) => ({id, username, isAdmin }));
}

function getRandomIndex(range = 8) {
  return Math.floor(Math.random() * range);
}

function chooseCards(roomCode) {
  const room = rooms[roomCode];

  const userCards = [];

  while (userCards.length < 3 && room.cardsBackup.length > 0) {
    const randomIndex = getRandomIndex(room.cardsBackup.length);
    userCards.push(room.cardsBackup.splice(randomIndex, 1)[0]);
  }

  console.log({ userCards });
  return userCards;
}

function handleRPS(cards) {
  const {userCard, oponentCard} = cards;
  const cardCombos = {
    "pedra": {
      "pedra": "empate",
      "papel": "oponente",
      "tesoura": "usuario"
    },
    "papel": {
      "pedra": "usuario",
      "papel": "empate",
      "tesoura": "oponente"
    },
    "tesoura": {
      "pedra": "oponente",
      "papel": "usuario",
      "tesoura": "empate"
    }
  };
  return cardCombos[userCard][oponentCard];
}

function getRoomPoints(roomCode) {
  return {
    user: rooms[roomCode].userPoints,
    oponent: rooms[roomCode].oponentPoints,
  }
}

function resetCards(roomCode) {
  if(rooms[roomCode]) {
    rooms[roomCode].cardsBackup = [...cards];
    rooms[roomCode].cardsSelected = {
      userCard: null,
      oponentCard: null
    };
    rooms[roomCode].userPoints = 0;
    rooms[roomCode].oponentPoints = 0;

    io.to(roomCode).emit("result_game", getRoomPoints(roomCode));
  };
}

function validUsername(socket, username) {
  if (!username) {
    socket.emit("connectionError", new Error("Username invalido!"));
    return false;
  }
  if (username.length < 3) {
    socket.emit("connectionError", new Error("Username muito looongo"));
    return false;
  }
  if (username.length > 10) {
    socket.emit("connectionError", new Error("Username muito curtinho"));
    return false;
  }

  socket.data.username = username;
  return true;
}

const PORT = 3000;
httpServer.listen(PORT, () => console.log(`Ouvindo na porta ${PORT}`));
