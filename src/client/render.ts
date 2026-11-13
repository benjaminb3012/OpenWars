/**
 * Canvas renderer.
 *
 * Two offscreen layers keep the frame cheap:
 *  - `terrainCanvas` is painted once from the terrain layer;
 *  - `ownerCanvas` is repainted from the ownership layer (1 pixel per tile)
 *    whenever the tile deltas arrive.
 * Zoomed rendering is then just two drawImage calls plus a handful of vectors.
 */

import { BUILDINGS, type BuildingType } from "@openwars/shared";
import type { Store } from "./state";

interface Rgb {
  r: number;
  g: number;
  b: number;
}

const TERRAIN_LAND_DARK = { r: 58, g: 76, b: 52 };
const TERRAIN_LAND_LIGHT = { r: 126, g: 148, b: 96 };
const OCEAN_DEEP = { r: 12, g: 26, b: 46 };
const OCEAN_SHALLOW = { r: 28, g: 62, b: 92 };
const LAKE = { r: 36, g: 86, b: 108 };

export class MapRenderer {
  private ctx: CanvasRenderingContext2D;
  private terrainCanvas: HTMLCanvasElement;
  private ownerCanvas: HTMLCanvasElement;
  private ownerImage: ImageData | null = null;
  private colors = new Map<number, Rgb>();

  scale = 3;
  offsetX = 0;
  offsetY = 0;
  hover: { x: number; y: number } | null = null;
  ghost: BuildingType | null = null;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly store: Store,
  ) {
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Canvas 2D indisponible");
    this.ctx = context;
    this.terrainCanvas = document.createElement("canvas");
    this.ownerCanvas = document.createElement("canvas");
  }

  resize(): void {
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.floor(this.canvas.clientWidth * ratio);
    this.canvas.height = Math.floor(this.canvas.clientHeight * ratio);
    this.ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  }

  fit(): void {
    const width = this.canvas.clientWidth;
    const height = this.canvas.clientHeight;
    if (!this.store.width || !this.store.height) return;
    this.scale = Math.min(width / this.store.width, height / this.store.height) * 0.96;
    this.offsetX = (width - this.store.width * this.scale) / 2;
    this.offsetY = (height - this.store.height * this.scale) / 2;
  }

  centerOn(tile: number): void {
    const x = tile % this.store.width;
    const y = Math.floor(tile / this.store.width);
    this.offsetX = this.canvas.clientWidth / 2 - x * this.scale;
    this.offsetY = this.canvas.clientHeight / 2 - y * this.scale;
  }

  screenToTile(clientX: number, clientY: number): { x: number; y: number } {
    const rect = this.canvas.getBoundingClientRect();
    const x = (clientX - rect.left - this.offsetX) / this.scale;
    const y = (clientY - rect.top - this.offsetY) / this.scale;
    return { x: Math.floor(x), y: Math.floor(y) };
  }

  zoomAt(clientX: number, clientY: number, factor: number): void {
    const rect = this.canvas.getBoundingClientRect();
    const px = clientX - rect.left;
    const py = clientY - rect.top;
    const before = { x: (px - this.offsetX) / this.scale, y: (py - this.offsetY) / this.scale };
    this.scale = Math.min(18, Math.max(0.6, this.scale * factor));
    this.offsetX = px - before.x * this.scale;
    this.offsetY = py - before.y * this.scale;
  }

  pan(dx: number, dy: number): void {
    this.offsetX += dx;
    this.offsetY += dy;
  }

  /** Paints the terrain layer (once per game). */
  refreshTerrain(): void {
    const { width, height, terrain } = this.store;
    if (!terrain || !width || !height) return;
    this.terrainCanvas.width = width;
    this.terrainCanvas.height = height;
    const ctx = this.terrainCanvas.getContext("2d");
    if (!ctx) return;
    const image = ctx.createImageData(width, height);
    const data = image.data;
    for (let i = 0; i < terrain.length; i++) {
      const value = terrain[i]!;
      const noise = ((i * 2654435761) % 255) / 255;
      let color: Rgb;
      if (value === 1) {
        const t = 0.35 + noise * 0.65;
        color = {
          r: Math.round(TERRAIN_LAND_DARK.r + (TERRAIN_LAND_LIGHT.r - TERRAIN_LAND_DARK.r) * t),
          g: Math.round(TERRAIN_LAND_DARK.g + (TERRAIN_LAND_LIGHT.g - TERRAIN_LAND_DARK.g) * t),
          b: Math.round(TERRAIN_LAND_DARK.b + (TERRAIN_LAND_LIGHT.b - TERRAIN_LAND_DARK.b) * t),
        };
      } else if (value === 2) {
        color = LAKE;
      } else {
        const t = noise * 0.5;
        color = {
          r: Math.round(OCEAN_DEEP.r + (OCEAN_SHALLOW.r - OCEAN_DEEP.r) * t),
          g: Math.round(OCEAN_DEEP.g + (OCEAN_SHALLOW.g - OCEAN_DEEP.g) * t),
          b: Math.round(OCEAN_DEEP.b + (OCEAN_SHALLOW.b - OCEAN_DEEP.b) * t),
        };
      }
      const offset = i * 4;
      data[offset] = color.r;
      data[offset + 1] = color.g;
      data[offset + 2] = color.b;
      data[offset + 3] = 255;
    }
    ctx.putImageData(image, 0, 0);
    this.ownerImage = null;
  }

  /** Repaints the ownership layer, borders included. */
  refreshOwnership(): void {
    const { width, height, owner } = this.store;
    if (!owner || !width || !height) return;
    if (!this.ownerImage || this.ownerCanvas.width !== width) {
      this.ownerCanvas.width = width;
      this.ownerCanvas.height = height;
      const ctx = this.ownerCanvas.getContext("2d");
      if (!ctx) return;
      this.ownerImage = ctx.createImageData(width, height);
      this.colors.clear();
    }
    const image = this.ownerImage;
    const data = image.data;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const tile = y * width + x;
        const id = owner[tile]!;
        const offset = tile * 4;
        if (id === 0) {
          data[offset + 3] = 0;
          continue;
        }
        const color = this.colorOf(id);
        const border =
          (x + 1 < width && owner[tile + 1] !== id) ||
          (x - 1 >= 0 && owner[tile - 1] !== id) ||
          (y + 1 < height && owner[tile + width] !== id) ||
          (y - 1 >= 0 && owner[tile - width] !== id);
        if (border) {
          data[offset] = Math.round(color.r * 0.35 + 40);
          data[offset + 1] = Math.round(color.g * 0.35 + 40);
          data[offset + 2] = Math.round(color.b * 0.35 + 40);
          data[offset + 3] = 255;
        } else {
          const scorched = this.store.scorch.has(tile);
          data[offset] = scorched ? Math.round(color.r * 0.45 + 18) : color.r;
          data[offset + 1] = scorched ? Math.round(color.g * 0.45 + 14) : color.g;
          data[offset + 2] = scorched ? Math.round(color.b * 0.45 + 12) : color.b;
          data[offset + 3] = scorched ? 240 : 205;
        }
      }
    }
    const ctx = this.ownerCanvas.getContext("2d");
    ctx?.putImageData(image, 0, 0);
  }

  private colorOf(playerId: number): Rgb {
    let color = this.colors.get(playerId);
    if (color) return color;
    const hex = this.store.player(playerId)?.country.color ?? "#8a8f98";
    color = parseHex(hex);
    this.colors.set(playerId, color);
    return color;
  }

  draw(): void {
    const ctx = this.ctx;
    const width = this.canvas.clientWidth;
    const height = this.canvas.clientHeight;
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = "#060b12";
    ctx.fillRect(0, 0, width, height);
    if (!this.store.terrain || !this.store.width) return;

    const mapWidth = this.store.width * this.scale;
    const mapHeight = this.store.height * this.scale;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.terrainCanvas, this.offsetX, this.offsetY, mapWidth, mapHeight);
    if (this.ownerCanvas.width > 0) {
      ctx.drawImage(this.ownerCanvas, this.offsetX, this.offsetY, mapWidth, mapHeight);
    }

    this.drawBuildings(ctx);
    this.drawUnits(ctx);
    this.drawLabels(ctx);
    this.drawHover(ctx);
  }

  private drawBuildings(ctx: CanvasRenderingContext2D): void {
    if (this.store.buildings.size === 0) return;
    const scale = this.scale;
    const width = this.store.width;
    for (const building of this.store.buildings.values()) {
      const x = (building.tile % width) * scale + this.offsetX;
      const y = Math.floor(building.tile / width) * scale + this.offsetY;
      if (x < -20 || y < -20 || x > this.canvas.clientWidth + 20 || y > this.canvas.clientHeight + 20) {
        continue;
      }
      const color = this.store.player(building.ownerId)?.country.color ?? "#cccccc";
      if (scale >= 6) {
        ctx.font = `${Math.min(26, scale * 2.4)}px "Apple Color Emoji","Segoe UI Emoji",sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        const icon = building.type === "road" ? "" : BUILDINGS[building.type].icon;
        if (icon) ctx.fillText(icon, x + scale / 2, y + scale / 2);
        if (building.buildRemaining > 0) {
          ctx.strokeStyle = "rgba(255,255,255,0.55)";
          ctx.lineWidth = 1;
          ctx.strokeRect(x + 0.5, y + 0.5, scale - 1, scale - 1);
        }
      } else {
        ctx.fillStyle = color;
        ctx.fillRect(x - 0.5, y - 0.5, Math.max(2, scale * 0.7), Math.max(2, scale * 0.7));
      }
    }
  }

  private drawUnits(ctx: CanvasRenderingContext2D): void {
    const scale = this.scale;
    const toScreen = (tx: number, ty: number): { x: number; y: number } => ({
      x: tx * scale + this.offsetX + scale / 2,
      y: ty * scale + this.offsetY + scale / 2,
    });

    for (const ship of this.store.tradeShips) {
      const point = toScreen(ship.x, ship.y);
      ctx.fillStyle = this.store.player(ship.ownerId)?.country.color ?? "#ffffff";
      ctx.globalAlpha = 0.85;
      ctx.beginPath();
      ctx.arc(point.x, point.y, Math.max(1.5, scale * 0.32), 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    for (const boat of this.store.boats) {
      const point = toScreen(boat.x, boat.y);
      const color = this.store.player(boat.ownerId)?.country.color ?? "#ffffff";
      ctx.fillStyle = color;
      ctx.strokeStyle = "rgba(0,0,0,0.6)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      const size = Math.max(3, scale * 0.9);
      if (boat.kind === "warship") {
        ctx.moveTo(point.x, point.y - size);
        ctx.lineTo(point.x + size, point.y + size * 0.7);
        ctx.lineTo(point.x - size, point.y + size * 0.7);
        ctx.closePath();
      } else {
        ctx.moveTo(point.x - size, point.y);
        ctx.lineTo(point.x, point.y + size);
        ctx.lineTo(point.x + size, point.y);
        ctx.closePath();
      }
      ctx.fill();
      ctx.stroke();
    }

    for (const plane of this.store.planes) {
      const point = toScreen(plane.x, plane.y);
      ctx.fillStyle = plane.kind === "fighter" ? "#ff9a6b" : "#d8e6f5";
      ctx.beginPath();
      ctx.arc(point.x, point.y, Math.max(1.4, scale * 0.28), 0, Math.PI * 2);
      ctx.fill();
    }

    for (const missile of this.store.missiles) {
      const from = toScreen(missile.fromX, missile.fromY);
      const to = toScreen(missile.toX, missile.toY);
      ctx.strokeStyle = "rgba(255,120,90,0.75)";
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(from.x, from.y);
      ctx.lineTo(to.x, to.y);
      ctx.stroke();
      ctx.setLineDash([]);
      const impact = {
        x: from.x + (to.x - from.x) * missile.progress,
        y: from.y + (to.y - from.y) * missile.progress,
      };
      ctx.fillStyle = "#ffd166";
      ctx.beginPath();
      ctx.arc(impact.x, impact.y, Math.max(2, scale * 0.5), 0, Math.PI * 2);
      ctx.fill();
    }
  }

  private drawLabels(ctx: CanvasRenderingContext2D): void {
    if (this.scale < 1.4) return;
    const scale = this.scale;
    const width = this.store.width;
    for (const player of this.store.players.values()) {
      if (!player.country.name) continue;
      const x = (player.capital % width) * scale + this.offsetX;
      const y = Math.floor(player.capital / width) * scale + this.offsetY;
      if (x < -100 || y < -40 || x > this.canvas.clientWidth + 100 || y > this.canvas.clientHeight + 40) {
        continue;
      }
      const label = `${player.country.flag} ${player.country.name}`;
      ctx.font = `600 ${Math.min(15, 9 + scale * 0.9)}px "Inter", system-ui, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      const metrics = ctx.measureText(label);
      const padding = 5;
      ctx.fillStyle = "rgba(6, 12, 20, 0.66)";
      roundRect(ctx, x - metrics.width / 2 - padding, y - 22, metrics.width + padding * 2, 17, 4);
      ctx.fill();
      ctx.fillStyle = "#e8eef7";
      ctx.fillText(label, x, y - 13.5);
    }
  }

  private drawHover(ctx: CanvasRenderingContext2D): void {
    const scale = this.scale;
    if (this.hover) {
      const { x, y } = this.hover;
      if (x >= 0 && y >= 0 && x < this.store.width && y < this.store.height) {
        const px = x * scale + this.offsetX;
        const py = y * scale + this.offsetY;
        ctx.strokeStyle = this.ghost ? "rgba(120, 220, 255, 0.95)" : "rgba(255,255,255,0.7)";
        ctx.lineWidth = 2;
        ctx.strokeRect(px, py, scale, scale);
        if (this.ghost) {
          ctx.fillStyle = "rgba(120, 220, 255, 0.25)";
          ctx.fillRect(px, py, scale, scale);
        }
      }
    }
  }
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + width, y, x + width, y + height, radius);
  ctx.arcTo(x + width, y + height, x, y + height, radius);
  ctx.arcTo(x, y + height, x, y, radius);
  ctx.arcTo(x, y, x + width, y, radius);
  ctx.closePath();
}

function parseHex(hex: string): Rgb {
  const match = /^#?([0-9a-fA-F]{6})$/.exec(hex);
  if (!match) return { r: 150, g: 150, b: 150 };
  const value = parseInt(match[1]!, 16);
  return { r: (value >> 16) & 0xff, g: (value >> 8) & 0xff, b: value & 0xff };
}
