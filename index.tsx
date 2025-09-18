import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { createRoot } from 'react-dom/client';
import { initializeApp } from "firebase/app";
import { getDatabase, ref, set, onValue, off, remove } from "firebase/database";

// --- Firebase Config ---
const firebaseConfig = {
  apiKey: "AIzaSyD84dFgEycyoWDHABDXiv_Jx2r0bGaPJRc",
  authDomain: "roaster-423fc.firebaseapp.com",
  databaseURL: "https://roaster-423fc-default-rtdb.firebaseio.com",
  projectId: "roaster-423fc",
  storageBucket: "roaster-423fc.firebasestorage.app",
  messagingSenderId: "443678344200",
  appId: "1:443678344200:web:5e9030dcfa34b1c2b9bdbd",
};
const app = initializeApp(firebaseConfig);
const db = getDatabase(app);


// --- Type Definitions ---
type Player = 'w' | 'b';
type PieceSymbol = 'p' | 'n' | 'b' | 'r' | 'q' | 'k';
type Piece = { type: PieceSymbol; color: Player; };
type Square = Piece | null;
type Board = Square[][];
type Position = { row: number; col: number };
type CastlingRights = { w: { k: boolean; q: boolean }; b: { k: boolean; q: boolean }; };
type GameState = {
    history: Board[];
    turn: Player;
    castlingRights: CastlingRights;
    enPassantTarget: Position | null;
    kingInCheckPos: Position | null;
    status: string;
};
type OnlineGameState = GameState & {
    players: { w?: string, b?: string };
    rematch?: { w?: boolean, b?: boolean };
};
type Move = { from: Position; to: Position };
type View = 'home' | 'lobby' | 'game';
type GameMode = 'ai' | 'online';


// --- Constants ---
const UNICODE_PIECES: Record<Player, Record<PieceSymbol, string>> = {
    b: { p: '♟', n: '♞', b: '♝', r: '♜', q: '♛', k: '♚' },
    w: { p: '♙', n: '♘', b: '♗', r: '♖', q: '♕', k: '♔' }
};
const PIECE_VALUES: Record<PieceSymbol, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 100 };
const INITIAL_PIECE_COUNT: Record<PieceSymbol, number> = { p: 8, n: 2, b: 2, r: 2, q: 1, k: 0 }; // King not counted as it can't be captured

const getInitialBoard = (): Board => [
    [{type: 'r', color: 'b'}, {type: 'n', color: 'b'}, {type: 'b', color: 'b'}, {type: 'q', color: 'b'}, {type: 'k', color: 'b'}, {type: 'b', color: 'b'}, {type: 'n', color: 'b'}, {type: 'r', color: 'b'}],
    [{type: 'p', color: 'b'}, {type: 'p', color: 'b'}, {type: 'p', color: 'b'}, {type: 'p', color: 'b'}, {type: 'p', color: 'b'}, {type: 'p', color: 'b'}, {type: 'p', color: 'b'}, {type: 'p', color: 'b'}],
    [null, null, null, null, null, null, null, null],
    [null, null, null, null, null, null, null, null],
    [null, null, null, null, null, null, null, null],
    [null, null, null, null, null, null, null, null],
    [{type: 'p', color: 'w'}, {type: 'p', color: 'w'}, {type: 'p', color: 'w'}, {type: 'p', color: 'w'}, {type: 'p', color: 'w'}, {type: 'p', color: 'w'}, {type: 'p', color: 'w'}, {type: 'p', color: 'w'}],
    [{type: 'r', color: 'w'}, {type: 'n', color: 'w'}, {type: 'b', color: 'w'}, {type: 'q', color: 'w'}, {type: 'k', color: 'w'}, {type: 'b', color: 'w'}, {type: 'n', color: 'w'}, {type: 'r', color: 'w'}],
];
const getInitialGameState = (): GameState => ({
    history: [getInitialBoard()],
    turn: 'w',
    castlingRights: { w: { k: true, q: true }, b: { k: true, q: true } },
    enPassantTarget: null,
    kingInCheckPos: null,
    status: "White's Turn",
});


// --- Chess Logic ---
const isPositionOnBoard = (row: number, col: number) => row >= 0 && row < 8 && col >= 0 && col < 8;

const isSquareAttacked = (board: Board, position: Position, attackerColor: Player): boolean => {
    for (let r = 0; r < 8; r++) { for (let c = 0; c < 8; c++) {
        const piece = board[r][c];
        if (piece && piece.color === attackerColor) {
            if (piece.type === 'p') {
                const dir = attackerColor === 'w' ? -1 : 1;
                if (position.row === r + dir && (position.col === c - 1 || position.col === c + 1)) return true;
            } else {
                const moves = getPseudoLegalMovesForPiece(board, { row: r, col: c }, null, null);
                if (moves.some(move => move.row === position.row && move.col === position.col)) return true;
            }
        }
    }}
    return false;
};

const getPseudoLegalMovesForPiece = (board: Board, position: Position, castlingRights: CastlingRights | null, enPassantTarget: Position | null): Position[] => {
    const piece = board[position.row][position.col];
    if (!piece) return [];
    const moves: Position[] = [];
    const { type, color } = piece;
    const addMove = (row: number, col: number, canCapture: boolean = true) => {
        if (!isPositionOnBoard(row, col)) return;
        const target = board[row][col];
        if (target === null) moves.push({ row, col });
        else if (target.color !== color && canCapture) moves.push({ row, col });
    };
    const addSlidingMoves = (directions: number[][]) => {
        for (const [dr, dc] of directions) {
            let r = position.row + dr, c = position.col + dc;
            while (isPositionOnBoard(r, c)) {
                const target = board[r][c];
                if (target === null) moves.push({ row: r, col: c });
                else { if (target.color !== color) moves.push({ row: r, col: c }); break; }
                r += dr; c += dc;
            }
        }
    };
    switch (type) {
        case 'p':
            const dir = color === 'w' ? -1 : 1;
            const startRow = color === 'w' ? 6 : 1;
            if (isPositionOnBoard(position.row + dir, position.col) && !board[position.row + dir][position.col]) {
                addMove(position.row + dir, position.col, false);
                if (position.row === startRow && !board[position.row + 2 * dir][position.col]) addMove(position.row + 2 * dir, position.col, false);
            }
            [-1, 1].forEach(cd => {
                const r = position.row + dir, c = position.col + cd;
                if (isPositionOnBoard(r,c) && board[r][c] && board[r][c]?.color !== color) moves.push({row: r, col: c});
                if (enPassantTarget && r === enPassantTarget.row && c === enPassantTarget.col) moves.push({row: r, col: c});
            });
            break;
        case 'n': [[-2, -1], [-2, 1], [-1, -2], [-1, 2], [1, -2], [1, 2], [2, -1], [2, 1]].forEach(([dr, dc]) => addMove(position.row + dr, position.col + dc)); break;
        case 'b': addSlidingMoves([[-1, -1], [-1, 1], [1, -1], [1, 1]]); break;
        case 'r': addSlidingMoves([[-1, 0], [1, 0], [0, -1], [0, 1]]); break;
        case 'q': addSlidingMoves([[-1, -1], [-1, 1], [1, -1], [1, 1], [-1, 0], [1, 0], [0, -1], [0, 1]]); break;
        case 'k':
            [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]].forEach(([dr, dc]) => addMove(position.row + dr, position.col + dc));
            if (castlingRights) {
                const opponentColor = color === 'w' ? 'b' : 'w';
                if (!isSquareAttacked(board, position, opponentColor)) {
                    if (castlingRights[color].k && !board[position.row][position.col + 1] && !board[position.row][position.col + 2] && !isSquareAttacked(board, {row: position.row, col: position.col + 1}, opponentColor) && !isSquareAttacked(board, {row: position.row, col: position.col + 2}, opponentColor)) moves.push({row: position.row, col: position.col + 2});
                    if (castlingRights[color].q && !board[position.row][position.col - 1] && !board[position.row][position.col - 2] && !board[position.row][position.col - 3] && !isSquareAttacked(board, {row: position.row, col: position.col - 1}, opponentColor) && !isSquareAttacked(board, {row: position.row, col: position.col - 2}, opponentColor)) moves.push({row: position.row, col: position.col - 2});
                }
            }
            break;
    }
    return moves;
};

const findKing = (board: Board, color: Player): Position | null => {
    for (let r = 0; r < 8; r++) { for (let c = 0; c < 8; c++) {
        const piece = board[r][c];
        if (piece && piece.type === 'k' && piece.color === color) return { row: r, col: c };
    }}
    return null;
};
const isKingInCheck = (board: Board, kingColor: Player): boolean => {
    const kingPos = findKing(board, kingColor);
    if (!kingPos) return true;
    return isSquareAttacked(board, kingPos, kingColor === 'w' ? 'b' : 'w');
};

const getLegalMoves = (board: Board, turn: Player, castlingRights: CastlingRights, enPassantTarget: Position | null, position: Position): Position[] => {
    const piece = board[position.row][position.col];
    if (!piece) return [];
    const pseudoLegalMoves = getPseudoLegalMovesForPiece(board, position, castlingRights, enPassantTarget);
    return pseudoLegalMoves.filter(move => {
        const tempBoard = JSON.parse(JSON.stringify(board));
        tempBoard[move.row][move.col] = tempBoard[position.row][position.col];
        tempBoard[position.row][position.col] = null;
        if (piece.type === 'k' && Math.abs(position.col - move.col) === 2) {
             const rookCol = move.col > position.col ? 7 : 0;
             const newRookCol = move.col > position.col ? 5 : 3;
             tempBoard[position.row][newRookCol] = tempBoard[position.row][rookCol];
             tempBoard[position.row][rookCol] = null;
        }
        return !isKingInCheck(tempBoard, piece.color);
    });
};

const hasAnyLegalMoves = (board: Board, turn: Player, castlingRights: CastlingRights, enPassantTarget: Position | null): boolean => {
    for (let r = 0; r < 8; r++) { for (let c = 0; c < 8; c++) {
        const piece = board[r][c];
        if (piece && piece.color === turn) {
            if (getLegalMoves(board, turn, castlingRights, enPassantTarget, { row: r, col: c }).length > 0) return true;
        }
    }}
    return false;
};

const calculateStatus = (board: Board, turn: Player, castlingRights: CastlingRights, enPassantTarget: Position | null): string => {
    const inCheck = isKingInCheck(board, turn);
    const hasMoves = hasAnyLegalMoves(board, turn, castlingRights, enPassantTarget);
    if (!hasMoves) return inCheck ? `Checkmate! ${turn === 'w' ? 'Black' : 'White'} wins.` : "Stalemate! It's a draw.";
    const turnText = `${turn === 'w' ? 'White' : 'Black'}'s Turn`;
    return inCheck ? `Check! ${turnText}` : turnText;
}

const applyMoveToGameState = (gameState: GameState, from: Position, to: Position): GameState => {
    const { history, turn, castlingRights } = gameState;
    const board = history[history.length - 1];
    const piece = board[from.row][from.col];
    if (!piece) return gameState;

    const newBoard: Board = JSON.parse(JSON.stringify(board));
    const newCastlingRights: CastlingRights = JSON.parse(JSON.stringify(castlingRights));
    let newEnPassantTarget: Position | null = null;
    
    newBoard[to.row][to.col] = piece;
    newBoard[from.row][from.col] = null;

    if (piece.type === 'p') {
        if (to.row === 0 || to.row === 7) newBoard[to.row][to.col]!.type = 'q';
        if (gameState.enPassantTarget && to.row === gameState.enPassantTarget.row && to.col === gameState.enPassantTarget.col) {
            const capturedPawnRow = turn === 'w' ? to.row + 1 : to.row - 1;
            newBoard[capturedPawnRow][to.col] = null;
        }
        if (Math.abs(from.row - to.row) === 2) newEnPassantTarget = { row: (from.row + to.row) / 2, col: from.col };
    }

    if (piece.type === 'k') {
        if (Math.abs(from.col - to.col) === 2) {
            const rookCol = to.col > from.col ? 7 : 0;
            const newRookCol = to.col > from.col ? 5 : 3;
            newBoard[from.row][newRookCol] = newBoard[from.row][rookCol];
            newBoard[from.row][rookCol] = null;
        }
        newCastlingRights[piece.color] = { k: false, q: false };
    }

    if (piece.type === 'r') {
        if (from.col === 0 && from.row === (piece.color === 'w' ? 7 : 0)) newCastlingRights[piece.color].q = false;
        if (from.col === 7 && from.row === (piece.color === 'w' ? 7 : 0)) newCastlingRights[piece.color].k = false;
    }
    
    const opponentColor = piece.color === 'w' ? 'b' : 'w';
    if (board[to.row][to.col]?.type === 'r') {
         if (to.col === 0 && to.row === (opponentColor === 'w' ? 7 : 0)) newCastlingRights[opponentColor].q = false;
         if (to.col === 7 && to.row === (opponentColor === 'w' ? 7 : 0)) newCastlingRights[opponentColor].k = false;
    }

    const nextTurn = turn === 'w' ? 'b' : 'w';
    const newKingInCheck = isKingInCheck(newBoard, nextTurn);
    const kingPos = newKingInCheck ? findKing(newBoard, nextTurn) : null;
    
    return {
        history: [...history, newBoard],
        turn: nextTurn,
        castlingRights: newCastlingRights,
        enPassantTarget: newEnPassantTarget,
        kingInCheckPos: kingPos,
        status: calculateStatus(newBoard, nextTurn, newCastlingRights, newEnPassantTarget),
    };
};


// --- React Components ---

const GameSquare = ({ piece, isLight, isSelected, isValidMove, isCaptureMove, isKingInCheck, isClickable, onClick }: {
    piece: Square; isLight: boolean; isSelected: boolean; isValidMove: boolean; isCaptureMove: boolean; isKingInCheck: boolean; isClickable: boolean; onClick: () => void;
}) => (
    <div className={['square', isLight ? 'light' : 'dark', isSelected && 'selected', isValidMove && 'valid-move', isCaptureMove && 'capture-move', isKingInCheck && 'check', isClickable && 'clickable'].filter(Boolean).join(' ')} onClick={onClick}>
        {piece && <span className={`piece ${piece.color}`}>{UNICODE_PIECES[piece.color][piece.type]}</span>}
    </div>
);

const Chessboard = ({ board, selectedPiece, validMoves, kingInCheckPos, onSquareClick, isBoardLocked }: {
    board: Board; selectedPiece: Position | null; validMoves: Position[]; kingInCheckPos: Position | null; onSquareClick: (pos: Position) => void; isBoardLocked: boolean;
}) => (
    <div className="board" style={{ pointerEvents: isBoardLocked ? 'none' : 'auto', opacity: isBoardLocked ? 0.7 : 1 }}>
        {board.map((row, r) => row.map((piece, c) => (
            <GameSquare key={`${r}-${c}`} piece={piece} isLight={(r + c) % 2 !== 0}
                isSelected={selectedPiece?.row === r && selectedPiece?.col === c}
                isValidMove={validMoves.some(m => m.row === r && m.col === c)}
                isCaptureMove={validMoves.some(m => m.row === r && m.col === c) && board[r][c] !== null}
                isKingInCheck={kingInCheckPos?.row === r && kingInCheckPos?.col === c}
                isClickable={!isBoardLocked}
                onClick={() => onSquareClick({ row: r, col: c })}
            />
        )))}
    </div>
);

const CapturedPieces = ({ board, color }: { board: Board; color: Player; }) => {
    const captured: Piece[] = [];
    const opponentColor = color === 'w' ? 'b' : 'w';

    const pieceCountsOnBoard: Record<PieceSymbol, number> = { p: 0, n: 0, b: 0, r: 0, q: 0, k: 0 };

    for (const row of board) {
        for (const piece of row) {
            if (piece && piece.color === opponentColor) {
                pieceCountsOnBoard[piece.type]++;
            }
        }
    }

    (Object.keys(INITIAL_PIECE_COUNT) as PieceSymbol[]).forEach(type => {
        const capturedCount = INITIAL_PIECE_COUNT[type] - pieceCountsOnBoard[type];
        for (let i = 0; i < capturedCount; i++) {
            captured.push({ type, color: opponentColor });
        }
    });
    
    captured.sort((a, b) => PIECE_VALUES[a.type] - PIECE_VALUES[b.type]);

    return (
        <div className="captured-pieces">
            {captured.map((p, i) => (
                <span key={i} className={`piece ${p.color}`}>{UNICODE_PIECES[p.color][p.type]}</span>
            ))}
        </div>
    );
};

const EndGameModal = ({ status, onRematch, onMainMenu, gameMode, onRematchRequest, rematchRequested } : {
    status: string; onRematch: () => void; onMainMenu: () => void; gameMode: GameMode; onRematchRequest: () => void; rematchRequested?: boolean;
}) => (
    <div className="modal-overlay">
        <div className="modal-content">
            <h2>Game Over</h2>
            <p>{status}</p>
            {gameMode === 'online' && (
                <button onClick={onRematchRequest} disabled={rematchRequested}>
                    {rematchRequested ? "Waiting..." : "Rematch"}
                </button>
            )}
            {gameMode === 'ai' && <button onClick={onRematch}>Play Again</button>}
            <button onClick={onMainMenu}>Main Menu</button>
        </div>
    </div>
);

const GameMenuModal = ({ onResign, onQuit, onClose } : { onResign: ()=>void; onQuit: ()=>void; onClose: ()=>void; }) => (
    <div className="modal-overlay" onClick={onClose}>
        <div className="modal-content" onClick={e => e.stopPropagation()}>
            <h2>Menu</h2>
            <button onClick={onResign}>Resign</button>
            <button onClick={onQuit}>Quit to Main Menu</button>
            <button onClick={onClose}>Cancel</button>
        </div>
    </div>
);

const ChessGame = ({ gameMode, gameId, playerColor, onMainMenu }: {
    gameMode: GameMode; gameId?: string | null; playerColor: Player; onMainMenu: () => void;
}) => {
    const [gameState, setGameState] = useState<GameState>(getInitialGameState());
    const [onlineGameState, setOnlineGameState] = useState<OnlineGameState | null>(null);
    const [selectedPiece, setSelectedPiece] = useState<Position | null>(null);
    const [validMoves, setValidMoves] = useState<Position[]>([]);
    const [isAiThinking, setIsAiThinking] = useState(false);
    const [isMenuOpen, setIsMenuOpen] = useState(false);
    
    const currentGameState = useMemo(() => gameMode === 'online' ? onlineGameState : gameState, [gameMode, gameState, onlineGameState]);
    const currentBoard = useMemo(() => currentGameState?.history[currentGameState.history.length-1], [currentGameState]);

    useEffect(() => {
        if (gameMode === 'online' && gameId) {
            const gameRef = ref(db, `games/${gameId}`);
            const listener = onValue(gameRef, (snapshot) => {
                const data = snapshot.val();
                if (data) setOnlineGameState(data);
                else onMainMenu(); 
            });
            return () => off(gameRef, 'value', listener);
        }
    }, [gameMode, gameId, onMainMenu]);

    const updateOnlineGame = (newState: GameState | OnlineGameState) => {
        if (gameMode === 'online' && gameId) {
            const gameRef = ref(db, `games/${gameId}`);
            const players = onlineGameState?.players || {};
            const rematch = onlineGameState?.rematch || {};
            set(gameRef, { ...newState, players, rematch });
        }
    };
    
    const applyMove = useCallback((from: Position, to: Position) => {
        if (!currentGameState) return;
        const newState = applyMoveToGameState(currentGameState, from, to);
        setSelectedPiece(null);
        setValidMoves([]);
        if (gameMode === 'ai') {
            setGameState(newState);
        } else {
            updateOnlineGame(newState);
        }
    }, [currentGameState, gameMode, onlineGameState]);
    
    const handleSquareClick = (pos: Position) => {
        if (!currentGameState || !currentBoard) return;
        const piece = currentBoard[pos.row][pos.col];
        const isGameOver = currentGameState.status.includes('wins') || currentGameState.status.includes('draw');
        const isMyTurn = currentGameState.turn === playerColor;

        if (isGameOver || (gameMode === 'ai' && isAiThinking) || (gameMode === 'online' && !isMyTurn)) return;

        if (selectedPiece) {
            if (validMoves.some(m => m.row === pos.row && m.col === pos.col)) {
                applyMove(selectedPiece, pos);
            } else if (piece && piece.color === currentGameState.turn) {
                setSelectedPiece(pos);
                setValidMoves(getLegalMoves(currentBoard, currentGameState.turn, currentGameState.castlingRights, currentGameState.enPassantTarget, pos));
            } else {
                setSelectedPiece(null);
                setValidMoves([]);
            }
        } else if (piece && piece.color === currentGameState.turn) {
            setSelectedPiece(pos);
            setValidMoves(getLegalMoves(currentBoard, currentGameState.turn, currentGameState.castlingRights, currentGameState.enPassantTarget, pos));
        }
    };

    const evaluateBoard = (board: Board): number => {
        let score = 0;
        board.forEach(row => row.forEach(piece => {
            if (piece) score += PIECE_VALUES[piece.type] * (piece.color === 'w' ? 1 : -1);
        }));
        return score;
    };

    const getBestMove = useCallback((gs: GameState): Move | null => {
        const allPossibleMoves: { move: Move, score: number }[] = [];
        const board = gs.history[gs.history.length-1];
        for (let r = 0; r < 8; r++) { for (let c = 0; c < 8; c++) {
            if (board[r][c]?.color === gs.turn) {
                const from = { row: r, col: c };
                const moves = getLegalMoves(board, gs.turn, gs.castlingRights, gs.enPassantTarget, from);
                for (const to of moves) {
                    const tempState = applyMoveToGameState(gs, from, to);
                    const tempBoard = tempState.history[tempState.history.length-1];
                    allPossibleMoves.push({ move: { from, to }, score: evaluateBoard(tempBoard) });
                }
            }
        }}
        if (allPossibleMoves.length === 0) return null;
        let bestMoves: Move[] = [];
        let bestScore = gs.turn === 'b' ? Infinity : -Infinity;
        if (gs.turn === 'b') { // AI is Black, minimize score
            allPossibleMoves.forEach(({ move, score }) => {
                if (score < bestScore) { bestScore = score; bestMoves = [move]; }
                else if (score === bestScore) bestMoves.push(move);
            });
        } else { // AI is White, maximize score
             allPossibleMoves.forEach(({ move, score }) => {
                if (score > bestScore) { bestScore = score; bestMoves = [move]; }
                else if (score === bestScore) bestMoves.push(move);
            });
        }
        return bestMoves[Math.floor(Math.random() * bestMoves.length)];
    }, []);

    useEffect(() => {
        if (gameMode === 'ai' && gameState.turn !== playerColor && !gameState.status.includes('wins') && !gameState.status.includes('draw')) {
            setIsAiThinking(true);
            const timer = setTimeout(() => {
                const bestMove = getBestMove(gameState);
                if (bestMove) applyMove(bestMove.from, bestMove.to);
                setIsAiThinking(false);
            }, 1000);
            return () => clearTimeout(timer);
        }
    }, [gameMode, gameState, playerColor, applyMove, getBestMove]);
    
    const resetGame = () => {
        const initial = getInitialGameState();
        if (gameMode === 'ai') setGameState(initial);
        else if (gameId) {
            const newOnlineState = { ...initial, players: onlineGameState?.players || {}, rematch: {} };
            updateOnlineGame(newOnlineState);
        }
    };

    const handleRematchRequest = () => {
        if (gameMode !== 'online' || !gameId || !playerColor) return;
        const rematchRef = ref(db, `games/${gameId}/rematch/${playerColor}`);
        set(rematchRef, true);
    };

    const handleResign = () => {
        if (!currentGameState) return;
        const resignStatus = `${playerColor === 'w' ? 'White' : 'Black'} resigns. ${playerColor === 'w' ? 'Black' : 'White'} wins.`;
        const newState = { ...currentGameState, status: resignStatus };
        if (gameMode === 'ai') {
            setGameState(newState);
        } else {
            updateOnlineGame(newState);
        }
        setIsMenuOpen(false);
    };

    useEffect(() => {
        if (gameMode === 'online' && onlineGameState?.rematch?.w && onlineGameState?.rematch?.b) {
            resetGame();
        }
    }, [onlineGameState?.rematch, gameMode]);

    if (!currentGameState || !currentBoard) return <div className="screen-container"><h1>Loading Game...</h1></div>;

    const isGameOver = currentGameState.status.includes('wins') || currentGameState.status.includes('draw');
    const opponentColor = playerColor === 'w' ? 'b' : 'w';

    return (
        <div className="game-screen-container">
            {isGameOver && (
                <EndGameModal
                    status={currentGameState.status}
                    onRematch={resetGame}
                    onMainMenu={onMainMenu}
                    gameMode={gameMode}
                    onRematchRequest={handleRematchRequest}
                    rematchRequested={onlineGameState?.rematch?.[playerColor]}
                />
            )}
            {isMenuOpen && <GameMenuModal onResign={handleResign} onQuit={onMainMenu} onClose={() => setIsMenuOpen(false)} />}
            <div className="player-info-panel top">
                <span className="player-name">Opponent</span>
                <CapturedPieces board={currentBoard} color={playerColor} />
            </div>
            <Chessboard
                board={currentBoard}
                selectedPiece={selectedPiece}
                validMoves={validMoves}
                kingInCheckPos={currentGameState.kingInCheckPos}
                onSquareClick={handleSquareClick}
                isBoardLocked={isAiThinking || (gameMode === 'online' && currentGameState.turn !== playerColor)}
            />
             <div className="player-info-panel bottom">
                <span className="player-name">You ({playerColor === 'w' ? 'White' : 'Black'})</span>
                <CapturedPieces board={currentBoard} color={opponentColor} />
                 <div className="status">{isAiThinking ? 'AI is thinking...' : currentGameState.status}</div>
            </div>
            <button className="menu-button in-game-menu-button" onClick={() => setIsMenuOpen(true)}>Menu</button>
        </div>
    );
};

const HomeScreen = ({ onPlayOnline, onPlayAI }: { onPlayOnline: () => void; onPlayAI: () => void }) => (
    <div className="screen-container">
        <h1>Chess</h1>
        <button className="menu-button" onClick={onPlayOnline}>Play Online</button>
        <button className="menu-button" onClick={onPlayAI}>Play vs AI</button>
    </div>
);

const LobbyScreen = ({ onGameJoined, onBack }: { onGameJoined: (gameId: string, color: Player) => void; onBack: () => void; }) => {
    const [joinId, setJoinId] = useState('');
    const [createdGameId, setCreatedGameId] = useState<string | null>(null);
    const [isWaiting, setIsWaiting] = useState(false);
    const [error, setError] = useState('');

    useEffect(() => {
        if (!createdGameId || !isWaiting) return;

        const gameRef = ref(db, `games/${createdGameId}`);
        const listener = onValue(gameRef, (snapshot) => {
            const gameData = snapshot.val();
            if (gameData && gameData.players.b) {
                setIsWaiting(false);
                onGameJoined(createdGameId, 'w');
            }
        });

        return () => off(gameRef, 'value', listener);
    }, [createdGameId, isWaiting, onGameJoined]);

    const handleBack = () => {
        if(createdGameId) {
            remove(ref(db, `games/${createdGameId}`));
        }
        onBack();
    }

    const createGame = async () => {
        const newGameId = Math.random().toString(36).substring(2, 7).toUpperCase();
        const newGameRef = ref(db, `games/${newGameId}`);
        const initialGame: OnlineGameState = { ...getInitialGameState(), players: { w: 'player1' } };
        await set(newGameRef, initialGame);
        setCreatedGameId(newGameId);
        setIsWaiting(true);
    };

    const joinGame = async () => {
        if (!joinId) return;
        const gameRef = ref(db, `games/${joinId.toUpperCase()}`);
        onValue(gameRef, (snapshot) => {
            const data = snapshot.val();
            if (data && !data.players.b) {
                const playerRef = ref(db, `games/${joinId.toUpperCase()}/players/b`);
                set(playerRef, 'player2');
                onGameJoined(joinId.toUpperCase(), 'b');
            } else {
                setError("Game not found or is full.");
            }
        }, { onlyOnce: true });
    };

    if (isWaiting && createdGameId) {
        return (
             <div className="screen-container">
                <h1>Game Created</h1>
                <p>Share this ID with your friend:</p>
                <div className="copy-id-container">
                    <div className="game-id-display">{createdGameId}</div>
                    <button className="copy-button" onClick={() => navigator.clipboard.writeText(createdGameId)}>Copy</button>
                </div>
                <p className="waiting-text">Waiting for opponent to join...</p>
                <button className="menu-button back-button" onClick={handleBack}>Back</button>
            </div>
        )
    }

    return (
        <div className="screen-container">
            <h1>Play Online</h1>
            {error && <p className="lobby-error">{error}</p>}
            <button className="menu-button" onClick={createGame}>Create Game</button>
            <p className="or-divider">OR</p>
            <input 
                type="text" 
                className="lobby-input" 
                placeholder="ENTER GAME ID" 
                value={joinId}
                onChange={(e) => {
                    setJoinId(e.target.value.toUpperCase());
                    setError('');
                }}
                maxLength={5}
            />
            <button className="menu-button" onClick={joinGame}>Join Game</button>
            <button className="menu-button back-button" onClick={onBack}>Back</button>
        </div>
    );
};


const App = () => {
    const [view, setView] = useState<View>('home');
    const [gameMode, setGameMode] = useState<GameMode>('ai');
    const [gameId, setGameId] = useState<string | null>(null);
    const [playerColor, setPlayerColor] = useState<Player>('w');

    const handlePlayOnline = () => setView('lobby');
    const handlePlayAI = () => {
        setGameMode('ai');
        setPlayerColor('w');
        setGameId(null);
        setView('game');
    };

    const handleGameJoined = (id: string, color: Player) => {
        setGameMode('online');
        setGameId(id);
        setPlayerColor(color);
        setView('game');
    };

    const handleMainMenu = () => {
        if (gameMode === 'online' && gameId && playerColor === 'w') {
            const gameRef = ref(db, `games/${gameId}`);
            onValue(gameRef, (snapshot) => {
                if(snapshot.exists()) {
                     remove(gameRef);
                }
            }, { onlyOnce: true });
        }
        setGameId(null);
        setView('home');
    };

    if (view === 'home') return <HomeScreen onPlayOnline={handlePlayOnline} onPlayAI={handlePlayAI} />;
    if (view === 'lobby') return <LobbyScreen onGameJoined={handleGameJoined} onBack={() => setView('home')} />;
    if (view === 'game') return <ChessGame gameMode={gameMode} gameId={gameId} playerColor={playerColor} onMainMenu={handleMainMenu}/>;
    
    return null;
};

const container = document.getElementById('root');
const root = createRoot(container!);
root.render(<App />);