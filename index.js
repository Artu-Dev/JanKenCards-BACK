import express from "express";
import { createServer } from "http";
import { nanoid } from "nanoid";
import { Server } from "socket.io";

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: "https://jankencards.vercel.app/game" },
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

const ROCK = "pedra";
const PAPER = "papel";
const SCISSORS = "tesoura";

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
      if (socket.data.isAdmin) return handleDisconnectRoom(socket, "Você já esta em uma sala!");
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
        if (rooms[roomCode].usersCount < 2 || rooms[roomCode].cardsSelected.userCard || rooms[roomCode].cardsSelected.oponentCard) {
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
        io.to(roomCode).emit("oponentCards", 3);
        io.to(roomCode).emit("alreadyPlayed", false);

        socket.on("reset", () => {
          resetCards(roomCode);
          resetPoints(roomCode);
          io.to(roomCode).emit("oponentCards", 0);
          io.to(roomCode).emit("changeCards", []);
        });
      });

      socket.on("finish_game", () => {
        if(!socket.data.isAdmin) return false;
    
        const { roomCode } = usersOnRoom[socket.id];
        const {userCard, oponentCard} = rooms[roomCode].cardsSelected;
    
        if(userCard && oponentCard) {
          const result = handleRPS(rooms[roomCode].cardsSelected);
    
          if(result === "empate"){
            rooms[roomCode].userPoints += 0;
            rooms[roomCode].oponentPoints += 0;
            io.to(roomCode).emit("result_game", {
              points: getRoomPoints(roomCode), 
              winner: "empate"
            });
          } else if(result === "oponente"){
            rooms[roomCode].oponentPoints += 1;
            socket.emit("result_game", {
              points: getRoomPoints(roomCode), 
              winner: "oponente"
            });
            socket.broadcast.emit("result_game", {
              points: getRoomPoints(roomCode), 
              winner: "you"
            });
          } else if(result === "usuario"){
            rooms[roomCode].userPoints += 1;
            socket.emit("result_game", {
              points: getRoomPoints(roomCode), 
              winner: "you"
            });
            socket.broadcast.emit("result_game", {
              points: getRoomPoints(roomCode), 
              winner: "oponente"
            });
          }
    
          console.log(getRoomPoints(roomCode));
          
          socket.emit("cardsMatch", {
            you: rooms[roomCode].cardsSelected.userCard,
            oponent: rooms[roomCode].cardsSelected.oponentCard
          });
          socket.broadcast.emit("cardsMatch", {
            oponent: rooms[roomCode].cardsSelected.userCard,
            you: rooms[roomCode].cardsSelected.oponentCard
          });

          rooms[roomCode].cardsSelected.userCard = null;
          rooms[roomCode].cardsSelected.oponentCard = null;
          io.to(roomCode).emit("alreadyPlayed", false);
        }
      })
    });

    socket.on("enterRoom", (code) => {
      if (socket.data.isAdmin) return handleDisconnectRoom(socket, "Você já esta em uma sala!");
      if (!rooms[code]) {
        handleDisconnectRoom(socket, "Sala invalida!")
        return false;
      }
      if (rooms[code].usersCount === 2) {
        handleDisconnectRoom(socket, "Sala cheia!")
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
    handleDisconnectRoom(socket, "Sala cheia!");
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

    if(isAdmin){
      cardsSelected.userCard = selectedCard;
    } else {
      cardsSelected.oponentCard = selectedCard;
    }

    remainingCards.splice(cardIndex, 1);
    socket.emit("changeCards", remainingCards);
    socket.broadcast.emit("oponentCards", remainingCards.length);
    socket.broadcast.emit("alreadyPlayed", true);
    io.to(roomCode).emit("cardSelected", socket.id);
      
    
  })
}

function handleDisconnectRoom(socket, message) {
  if (usersOnRoom.hasOwnProperty(socket.id)) {
    const { roomCode } = usersOnRoom[socket.id];
    resetCards(roomCode);
    resetPoints(roomCode);
    delete usersOnRoom[socket.id];

    io.to(roomCode).emit("oponentCards", 0);
    io.to(roomCode).emit("changeCards", []);
    io.to(roomCode).emit("cardSelected", 0);
    io.to(roomCode).emit("alreadyPlayed", false);
    io.to(roomCode).emit("usersOnline", getUsersInRoom(roomCode));

    if (rooms[roomCode]) {
      rooms[roomCode].usersCount = (rooms[roomCode].usersCount || 0) - 1;
      if (socket.data.isAdmin) delete rooms[roomCode];
    }
  }

  socket.emit("disconnect_error", message);
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
    [ROCK]: {
      [ROCK]: "empate",
      [PAPER]: "oponente",
      [SCISSORS]: "usuario",
    },
    [PAPER]: {
      [ROCK]: "usuario",
      [PAPER]: "empate",
      [SCISSORS]: "oponente",
    },
    [SCISSORS]: {
      [ROCK]: "oponente",
      [PAPER]: "usuario",
      [SCISSORS]: "empate",
    },
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
  };
}

function resetPoints(roomCode) {
  if(rooms[roomCode]) {
    rooms[roomCode].userPoints = 0;
    rooms[roomCode].oponentPoints = 0;
    io.to(roomCode).emit("result_game", getRoomPoints(roomCode));
  }
}

function validUsername(socket, username) {
  if (!username) {
    handleDisconnectRoom(socket, "Username invalido!");
    return false;
  }
  if (username.length < 3) {
    handleDisconnectRoom(socket, "Username muito looongo!");
    return false;
  }
  if (username.length > 10) {
    handleDisconnectRoom(socket, "Username muito curtinho!");
    return false;
  }

  socket.data.username = username;
  return true;
}

const PORT = 3000;
httpServer.listen(PORT, () => console.log(`Ouvindo na porta ${PORT}`));
