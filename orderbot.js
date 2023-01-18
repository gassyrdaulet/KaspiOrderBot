import { fork } from "child_process";

const restartEveryXSeconds = 300;

function restart() {
  const app = fork("index.js");
  app.on("close", () => {
    console.log(
      "\x1b[36m",
      "\nСкрипт окончен. Следующий запуск через " +
        restartEveryXSeconds +
        " секунд...\n",
      "\x1b[0m"
    );
    setTimeout(() => {
      restart();
    }, restartEveryXSeconds * 1000);
  });
}
restart();
