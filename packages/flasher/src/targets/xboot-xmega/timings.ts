/** The xboot client's deadlines and pauses (client.ts uses them; exchange.ts takes them per page write). */
export interface ClientTimings {
  /** Reply deadline for a short command. */
  readonly replyMs: number;
  /** Reply deadline for a page read (512 bytes is about 45 ms at 115200 baud). */
  readonly blockReadMs: number;
  /** Reply deadline for a page write (transfer, erase, write). */
  readonly blockWriteMs: number;
  /** Reply deadline for the application CRC (xboot reads all 192 KB). */
  readonly crcMs: number;
  /** How long `S` may take to answer during entry. */
  readonly entryReplyMs: number;
  /** Pause between ESCs during entry. */
  readonly entryIntervalMs: number;
  /** How long a resync waits for the watchdog to reset a stuck board. */
  readonly watchdogMs: number;
  /** Keep-alive period while waiting on the page. */
  readonly keepAliveMs: number;
  /** After the entry: silence that ends the drain of late replies (quiet.ts). */
  readonly quietMs: number;
  /** After the entry: the drain gives up (desync) when the line is still busy after this long. */
  readonly quietMaxMs: number;
}
