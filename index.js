const express = require("express");
const Bull = require("bull");
const Redis = require("ioredis");
const { exec } = require("child_process");
const aws = require("aws-sdk");
const fs = require("fs");
const path = require("path");

require("dotenv").config({ path: "./.env" });

// Configuration de Redis
const redisClient = new Redis(
  "redis://default:ghCDMmngvRnnduNdUKXERyCbeMDpKVmr@junction.proxy.rlwy.net:35545"
);

// Configuration de Bull
const videoQueue = new Bull("video processing", {
  redis:
    "redis://default:ghCDMmngvRnnduNdUKXERyCbeMDpKVmr@junction.proxy.rlwy.net:35545",
});

// Configuration de AWS S3
const s3 = new aws.S3({
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  region: process.env.AWS_REGION,
});

// Créer l'application Express
const app = express();
app.use(express.json());

// Route pour soumettre une tâche de traitement vidéo
app.post("/download", async (req, res) => {
  const { url, withWatermark, watermarkText } = req.body;

  if (!url) {
    return res.status(400).json({ error: "L'URL est requise." });
  }

  const job = await videoQueue.add({
    url,
    withWatermark,
    watermarkText,
  });

  console.log(`Tâche ${job.id} soumise pour l'URL : ${url}`);
  res.status(202).json({ taskId: job.id });
});

// Route pour vérifier le statut de la tâche
app.get("/status/:taskId", async (req, res) => {
  const job = await videoQueue.getJob(req.params.taskId);

  if (!job) {
    return res.status(404).json({ error: "Tâche non trouvée." });
  }

  const status = await job.getState();
  const response = {
    state: status,
    result: job.returnvalue || null,
  };

  if (status === "completed") {
    console.log(`Tâche ${job.id} terminée avec succès.`);
  } else if (status === "failed") {
    console.log(`Tâche ${job.id} a échoué.`);
  }

  res.json(response);
});

// Processus de la file d'attente
videoQueue.process(async (job) => {
  const { url, withWatermark, watermarkText } = job.data;

  // Télécharger et traiter la vidéo
  const processedUrl = await processVideo(url, withWatermark, watermarkText);

  return processedUrl;
});

// Fonction pour télécharger et traiter la vidéo
async function processVideo(url, withWatermark, watermarkText) {
  return new Promise((resolve, reject) => {
    const outputFilePath = path.join(__dirname, "downloaded_video.mp4");

    // Télécharger la vidéo avec yt-dlp
    exec(`yt-dlp -o ${outputFilePath} ${url}`, (error, stdout, stderr) => {
      if (error) {
        console.error(`Erreur lors du téléchargement : ${stderr}`);
        return reject("Erreur lors du téléchargement de la vidéo");
      }

      // Ajouter un filigrane si nécessaire
      const finalOutputPath = withWatermark
        ? path.join(__dirname, "watermarked_video.mp4")
        : outputFilePath;

      if (withWatermark) {
        exec(
          `ffmpeg -i ${outputFilePath} -vf "drawtext=text='${watermarkText}':fontcolor=white:fontsize=24:x=(w-text_w)/2:y=20" -c:a copy ${finalOutputPath}`,
          (error) => {
            if (error) {
              console.error(`Erreur lors de l'ajout du filigrane : ${stderr}`);
              return reject("Erreur lors de l'ajout du filigrane");
            }
            uploadToS3(finalOutputPath, resolve, reject);
          }
        );
      } else {
        uploadToS3(finalOutputPath, resolve, reject);
      }
    });
  });
}

// Fonction pour uploader la vidéo sur S3
function uploadToS3(filePath, resolve, reject) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const fileName = `${timestamp}_${path.basename(filePath)}`;

  s3.upload(
    {
      Bucket: process.env.S3_BUCKET_NAME,
      Key: fileName,
      Body: fs.createReadStream(filePath),
      ACL: "public-read", // Rendre le fichier public
    },
    (error, data) => {
      if (error) {
        console.error(`Erreur lors de l'upload sur S3 : ${error}`);
        return reject("Erreur lors de l'upload sur S3");
      }

      console.log(`Fichier uploadé avec succès sur S3 : ${data.Location}`);
      fs.unlinkSync(filePath); // Supprimer le fichier local après upload
      resolve(data.Location);
    }
  );
}

// Démarrer le serveur
const PORT = process.env.PORT || 5555;
app.listen(PORT, () => {
  console.log(`Serveur en cours d'exécution sur le port ${PORT}`);
});
