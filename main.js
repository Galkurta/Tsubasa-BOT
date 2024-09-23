const fs = require("fs");
const path = require("path");
const axios = require("axios");
const winston = require("winston");
const readline = require("readline");
const prompt = require("prompt-sync")({ sigint: true });
const printBanner = require("./banner");
printBanner();

class Tsubasa {
  constructor() {
    this.headers = {
      Accept: "application/json, text/plain, */*",
      "Accept-Encoding": "gzip, deflate, br",
      "Accept-Language": "en-US;q=0.6,en;q=0.5",
      "Content-Type": "application/json",
      Origin: "https://app.ton.tsubasa-rivals.com",
      Referer: "https://app.ton.tsubasa-rivals.com/",
      "Sec-Ch-Ua":
        '"Not/A)Brand";v="99", "Google Chrome";v="115", "Chromium";v="115"',
      "Sec-Ch-Ua-Mobile": "?0",
      "Sec-Ch-Ua-Platform": '"Windows"',
      "Sec-Fetch-Dest": "empty",
      "Sec-Fetch-Mode": "cors",
      "Sec-Fetch-Site": "same-origin",
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36",
    };
    this.config = this.loadConfig();
    this.logger = winston.createLogger({
      level: "info",
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.colorize(),
        winston.format.printf(({ timestamp, level, message }) => {
          return `${timestamp} | ${level} | ${message}`;
        })
      ),
      transports: [new winston.transports.Console()],
    });
  }

  loadConfig() {
    console.log("Please configure the Tsubasa-BOT:");
    const enableCardUpgrades =
      prompt("Enable card upgrades? (y/n): ").toLowerCase() === "y";

    let maxUpgradeCost = 500000;
    if (enableCardUpgrades) {
      maxUpgradeCost = parseInt(
        prompt("Enter the maximum upgrade cost (e.g., 500000): "),
        10
      );
      if (isNaN(maxUpgradeCost)) {
        maxUpgradeCost = 500000;
      }
    }

    const config = {
      enableCardUpgrades,
      maxUpgradeCost,
    };

    console.log("Configuration loaded successfully.");
    return config;
  }

  async countdown(seconds) {
    for (let i = seconds; i >= 0; i--) {
      readline.cursorTo(process.stdout, 0);
      process.stdout.write(`Wait ${i} seconds to continue the loop`);
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    console.log("");
  }

  async callStartAPI(initData) {
    const startUrl = "https://app.ton.tsubasa-rivals.com/api/start";
    const startPayload = { lang_code: "en", initData: initData };

    try {
      const startResponse = await axios.post(startUrl, startPayload, {
        headers: this.headers,
      });
      if (
        startResponse.status === 200 &&
        startResponse.data &&
        startResponse.data.game_data
      ) {
        const {
          total_coins,
          energy,
          max_energy,
          coins_per_tap,
          profit_per_second,
        } = startResponse.data.game_data.user || {};
        const masterHash = startResponse.data.master_hash;
        if (masterHash) {
          this.headers["X-Masterhash"] = masterHash;
        }

        const tasks = startResponse.data.task_info
          ? startResponse.data.task_info.filter(
              (task) => task.status === 0 || task.status === 1
            )
          : [];

        return {
          total_coins,
          energy,
          max_energy,
          coins_per_tap,
          profit_per_second,
          tasks,
          success: true,
        };
      } else {
        return { success: false, error: `Error calling start API` };
      }
    } catch (error) {
      return {
        success: false,
        error: `Error calling start API: ${error.message}`,
      };
    }
  }

  async callTapAPI(initData, tapCount) {
    const tapUrl = "https://app.ton.tsubasa-rivals.com/api/tap";
    const tapPayload = { tapCount: tapCount, initData: initData };

    try {
      const tapResponse = await axios.post(tapUrl, tapPayload, {
        headers: this.headers,
      });
      if (tapResponse.status === 200) {
        const {
          total_coins,
          energy,
          max_energy,
          coins_per_tap,
          profit_per_second,
        } = tapResponse.data.game_data.user;
        return {
          total_coins,
          energy,
          max_energy,
          coins_per_tap,
          profit_per_second,
          success: true,
        };
      } else {
        return { success: false, error: `Tap error |  ${tapResponse.status}` };
      }
    } catch (error) {
      return { success: false, error: `Tap error |  ${error.message}` };
    }
  }

  async callDailyRewardAPI(initData) {
    const dailyRewardUrl =
      "https://app.ton.tsubasa-rivals.com/api/daily_reward/claim";
    const dailyRewardPayload = { initData: initData };

    try {
      const dailyRewardResponse = await axios.post(
        dailyRewardUrl,
        dailyRewardPayload,
        { headers: this.headers }
      );
      if (dailyRewardResponse.status === 200) {
        return { success: true, message: "Daily check-in successful" };
      } else {
        return { success: false, message: "You have already checked in today" };
      }
    } catch (error) {
      if (error.response && error.response.status === 400) {
        return { success: false, message: "You have already checked in today" };
      }
      return {
        success: false,
        message: `Daily check-in error |  ${error.message}`,
      };
    }
  }

  async executeTask(initData, taskId) {
    const executeUrl = "https://app.ton.tsubasa-rivals.com/api/task/execute";
    const executePayload = { task_id: taskId, initData: initData };

    try {
      const executeResponse = await axios.post(executeUrl, executePayload, {
        headers: this.headers,
      });
      return executeResponse.status === 200;
    } catch (error) {
      this.logger.error(`Error executing task ${taskId}: ${error.message}`);
      return false;
    }
  }

  async checkTaskAchievement(initData, taskId) {
    const achievementUrl =
      "https://app.ton.tsubasa-rivals.com/api/task/achievement";
    const achievementPayload = { task_id: taskId, initData: initData };

    try {
      const achievementResponse = await axios.post(
        achievementUrl,
        achievementPayload,
        { headers: this.headers }
      );
      if (achievementResponse.status === 200) {
        if (
          achievementResponse.data &&
          achievementResponse.data &&
          achievementResponse.data.task_info
        ) {
          const updatedTask = achievementResponse.data.task_info.find(
            (task) => task.id === taskId
          );
          if (updatedTask && updatedTask.status === 2) {
            return {
              success: true,
              title: updatedTask.title,
              reward: updatedTask.reward,
            };
          }
        }
      }
      return { success: false };
    } catch (error) {
      this.logger.error(`Error ${taskId}: ${error.message}`);
      return { success: false };
    }
  }

  async getCardInfo(initData) {
    const startUrl = "https://app.ton.tsubasa-rivals.com/api/start";
    const startPayload = { lang_code: "en", initData: initData };

    try {
      const startResponse = await axios.post(startUrl, startPayload, {
        headers: this.headers,
      });
      if (
        startResponse.status === 200 &&
        startResponse.data &&
        startResponse.data.card_info
      ) {
        const cardInfo = startResponse.data.card_info.flatMap((category) => {
          return category.card_list.map((card) => ({
            categoryId: card.category,
            cardId: card.id,
            level: card.level,
            cost: card.cost,
            unlocked: card.unlocked,
            name: card.name,
            profitPerHour: card.profit_per_hour,
            nextProfitPerHour: card.next_profit_per_hour,
          }));
        });
        return cardInfo;
      } else {
        this.logger.warn("Card information not found!");
        return null;
      }
    } catch (error) {
      this.logger.error(`Error getting card information: ${error.message}`);
      return null;
    }
  }

  async levelUpCards(initData, totalCoins) {
    if (!this.config.enableCardUpgrades) {
      this.logger.info("Card upgrades are disabled in config.");
      return totalCoins;
    }

    let updatedTotalCoins = totalCoins;
    let leveledUp = false;
    let cooldownCards = new Set();

    do {
      leveledUp = false;
      const cardInfo = await this.getCardInfo(initData);
      if (!cardInfo) {
        this.logger.warn(
          "Unable to get card information. Cancelling card upgrades!"
        );
        break;
      }

      const sortedCards = cardInfo.sort(
        (a, b) => b.nextProfitPerHour - a.nextProfitPerHour
      );

      for (const card of sortedCards) {
        if (cooldownCards.has(card.cardId)) {
          continue;
        }

        if (
          card.unlocked &&
          updatedTotalCoins >= card.cost &&
          card.cost <= this.config.maxUpgradeCost
        ) {
          const levelUpUrl =
            "https://app.ton.tsubasa-rivals.com/api/card/levelup";
          const levelUpPayload = {
            category_id: card.categoryId,
            card_id: card.cardId,
            initData: initData,
          };

          try {
            const levelUpResponse = await axios.post(
              levelUpUrl,
              levelUpPayload,
              { headers: this.headers }
            );
            if (levelUpResponse.status === 200) {
              updatedTotalCoins -= card.cost;
              leveledUp = true;
              this.logger.info(
                `Upgraded card | ${card.name} | ${card.cardId} | ${
                  card.level + 1
                }. Cost | ${
                  card.cost
                } | Remaining balance | ${updatedTotalCoins}`
              );
              break;
            }
          } catch (error) {
            if (
              error.response &&
              error.response.status === 400 &&
              error.response.data &&
              error.response.data.message === "Wait for cooldown"
            ) {
              this.logger.warn(
                `Not yet time for next upgrade for card | ${card.name} | ${card.cardId}`
              );
              cooldownCards.add(card.cardId);
            } else {
              this.logger.error(
                `Error upgrading card | ${card.name} | ${card.cardId} | ${error.message}`
              );
            }
          }
        }
      }
    } while (leveledUp);

    return updatedTotalCoins;
  }

  async main() {
    const dataFile = path.join(__dirname, "data.txt");
    const data = fs
      .readFileSync(dataFile, "utf8")
      .replace(/\r/g, "")
      .split("\n")
      .filter(Boolean);

    let lastUpgradeTime = 0;

    console.log("Configuration:");
    console.log(`Enable card upgrades: ${this.config.enableCardUpgrades}`);
    console.log(`Maximum upgrade cost: ${this.config.maxUpgradeCost}`);
    console.log("Press Enter to start the client...");
    prompt("");

    while (true) {
      for (let i = 0; i < data.length; i++) {
        const initData = data[i];
        const firstName = JSON.parse(
          decodeURIComponent(initData.split("user=")[1].split("&")[0])
        ).first_name;

        this.logger.info(`Account ${i + 1} | ${firstName}`);

        const startResult = await this.callStartAPI(initData);
        if (startResult.success) {
          if (startResult.total_coins !== undefined) {
            this.logger.info(`Balance: ${startResult.total_coins}`);
            this.logger.info(
              `Energy: ${startResult.energy}/${startResult.max_energy}`
            );
            this.logger.info(`Coins per tap: ${startResult.coins_per_tap}`);
            this.logger.info(
              `Profit per second: ${startResult.profit_per_second}`
            );
          }

          if (startResult.tasks && startResult.tasks.length > 0) {
            for (const task of startResult.tasks) {
              const executeResult = await this.executeTask(initData, task.id);
              if (executeResult) {
                const achievementResult = await this.checkTaskAchievement(
                  initData,
                  task.id
                );
                if (achievementResult.success) {
                  this.logger.info(
                    `Successfully completed task ${achievementResult.title} | reward ${achievementResult.reward}`
                  );
                }
              }
            }
          } else {
            this.logger.warn(`No tasks available.`);
          }

          if (startResult.energy !== undefined) {
            const tapResult = await this.callTapAPI(
              initData,
              startResult.energy
            );
            if (tapResult.success) {
              this.logger.info(
                `Tap successful | Remaining energy ${tapResult.energy}/${tapResult.max_energy} | Balance: ${tapResult.total_coins}`
              );
            } else {
              this.logger.error(tapResult.error);
            }
          }

          const dailyRewardResult = await this.callDailyRewardAPI(initData);
          this.logger.info(dailyRewardResult.message);

          const updatedTotalCoins = await this.levelUpCards(
            initData,
            startResult.total_coins
          );
          this.logger.info(
            `Finished upgrading all eligible cards | Balance: ${updatedTotalCoins}`
          );
        } else {
          this.logger.error(startResult.error);
        }

        await new Promise((resolve) => setTimeout(resolve, 1000));
      }

      await this.countdown(60);
    }
  }
}

const client = new Tsubasa();
client.main().catch((err) => {
  client.logger.error(err.message);
  process.exit(1);
});
