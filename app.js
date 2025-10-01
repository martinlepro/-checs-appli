// URL de votre service FastAPI déployé sur Render
const SERVER_URL = 'https://echecs-serveur.onrender.com';

// État de l'application
let board = null;
let game = new Chess();
let gameId = null;
let playerId = null;
let isBotPlaying = false; // Flag pour bloquer les coups pendant que le bot réfléchit

const config = {
    draggable: true,
    position: 'start',
    onDragStart: onDragStart,
    onDrop: onDrop,
    onSnapEnd: onSnapEnd,
    // Joueur humain est toujours les Blancs
    orientation: 'white' 
};

// Initialisation au chargement de la page
$(document).ready(function() {
    // Initialise le plateau sans pièces au début
    board = Chessboard('board', config);
    $('#new-game-form').on('submit', startNewGame);
    $('#reset-button').on('click', resetApp);
    updateStatus();
});

// --- Fonctions d'interaction avec le plateau ---

function onDragStart (source, piece, position, orientation) {
    // N'autorise pas le mouvement si la partie est terminée ou si ce n'est pas le tour des Blancs
    if (game.isGameOver() || isBotPlaying || game.turn() === 'b') {
        return false;
    }
    // N'autorise que le déplacement des pièces blanches (l'humain est toujours Blanc ici)
    if (piece.search(/^b/) !== -1) {
        return false;
    }
}

async function onDrop (source, target) {
    // Tente de faire le coup localement
    const move = game.move({
        from: source,
        to: target,
        promotion: 'q' // Simplifie la promotion en Reines par défaut
    });

    // Coup illégal
    if (move === null) {
        return 'snapback';
    }

    // Le coup est légal, donc on l'envoie au serveur
    try {
        isBotPlaying = true; // Bloque le plateau
        updateStatus("En attente de la réponse du serveur...");

        // 1. Envoi du coup au serveur
        const response = await fetch(`${SERVER_URL}/game/move`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                game_id: gameId,
                player_id: playerId,
                uci_move: move.uci
            })
        });

        if (!response.ok) {
            // Si le serveur a renvoyé une erreur (ex: coup illégal côté serveur)
            const errorData = await response.json();
            throw new Error(errorData.detail || "Erreur inconnue du serveur.");
        }

        const data = await response.json();
        
        // 2. Mise à jour de l'état local avec la réponse du serveur
        game.load(data.new_fen);
        updateStatus();

        // 3. Animation du coup du bot (si présent)
        if (data.bot_move) {
            // Le bot joue, nous devons mettre à jour l'affichage
            setTimeout(() => {
                board.move(data.bot_move); // Anime le coup du bot
                isBotPlaying = false; // Débloque le plateau après le coup du bot
                updateStatus();
            }, 500); // Petite pause pour l'effet
        } else {
            // S'il n'y a pas de coup de bot (ex: partie multijoueur future ou fin de partie)
            isBotPlaying = false;
        }

    } catch (error) {
        console.error('Erreur lors de l’envoi du coup au serveur:', error);
        // Annule le coup local pour l'utilisateur
        game.undo();
        board.position(game.fen());
        updateStatus(`Erreur: ${error.message}. Réessayez.`);
        isBotPlaying = false;
        return 'snapback';
    }
}

// Fonction appelée après l'animation de fin de coup (repositionnement)
function onSnapEnd () {
    board.position(game.fen());
}

// --- Fonctions d'interaction avec le serveur ---

async function startNewGame(event) {
    event.preventDefault();
    
    playerId = $('#player_id').val();
    const botLevel = parseInt($('#bot_level').val());
    
    try {
        // Envoi de la requête pour créer une nouvelle partie
        const response = await fetch(`${SERVER_URL}/game/new`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                player_white_id: playerId,
                opponent_type: 'bot',
                opponent_level: botLevel
            })
        });

        if (!response.ok) {
             const errorData = await response.json();
             throw new Error(errorData.detail || "Échec de la création de partie.");
        }

        const data = await response.json();
        gameId = data.game_id;
        game.reset(); // Réinitialise la logique de jeu locale
        board.position(data.initial_fen); // Affiche le plateau initial
        
        // Affiche la section de jeu et masque la section de configuration
        $('#setup-section').hide();
        $('#game-section').show();
        
        // Mise à jour des informations joueur/bot
        const selectedBot = $('#bot_level option:selected');
        const botIconPath = 'assets/bot_icons/' + selectedBot.data('icon');
        
        $('#bot-icon').attr('src', botIconPath);
        $('#bot-name').text(`Bot (${botLevel} Elo)`);
        $('#human-name').text(playerId);

        updateStatus("Partie commencée ! C'est le tour des Blancs.");

    } catch (error) {
        console.error('Erreur lors du démarrage de la partie:', error);
        alert(`Impossible de démarrer la partie. Vérifiez le serveur : ${error.message}`);
    }
}

function resetApp() {
    gameId = null;
    game.reset();
    board.position('start');
    $('#setup-section').show();
    $('#game-section').hide();
    $('#reset-button').hide();
}


// --- Fonction de Mise à Jour du Statut ---

function updateStatus (message = null) {
    if (message) {
        $('#game-status').html(`<span style="color: blue;">${message}</span>`);
        return;
    }
    
    let status = '';
    let moveColor = 'Blancs';

    if (game.turn() === 'b') {
        moveColor = 'Noirs';
    }

    if (game.isCheckmate()) {
        status = 'PARTIE TERMINÉE : ' + moveColor + ' est en échec et mat.';
        $('#reset-button').show();
    } else if (game.isDraw()) {
        status = 'PARTIE TERMINÉE : Nulle.';
        $('#reset-button').show();
    } else {
        status = `C'est au tour des ${moveColor} de jouer.`;
        if (game.isCheck()) {
            status += ` (${moveColor} est en échec)`;
        }
    }

    $('#game-status').text(status);
                                                                         }
