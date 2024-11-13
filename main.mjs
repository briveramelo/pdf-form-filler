import { PDFDocument } from 'pdf-lib';
import express from 'express';
import { Storage } from '@google-cloud/storage';
import dotenv from 'dotenv';
import stream from 'stream';

// Load environment variables
dotenv.config();
const envVars = {
    ...dotenv.config().parsed,
    ...process.env
};

const app = express();
app.use(express.json());  // Middleware for parsing JSON bodies

// Initialize Google Cloud Storage client
const storage = new Storage({
    projectId: envVars['GOOGLE_PROJECT_ID']
});
const bucketName = envVars['GCS_BUCKET'];

function validateFields(allowedValues, formData) {
    const invalidFields = [];

    // Check each field and collect invalid ones
    for (const [field, allowedSet] of Object.entries(allowedValues)) {
        if (!formData.hasOwnProperty(field)) {
            continue;
        }
        if (allowedSet.includes(formData[field])) {
            continue;
        }
        invalidFields.push({
            field,
            value: formData[field],
            allowed: allowedSet,
        });
    }

    // return invalidFields if any
    if (invalidFields.length > 0) {
        return invalidFields;
    }
}

function get_and_validate(){
    return async function (req, res, next) {
        const validationFileName = envVars['TEMPLATE_VALIDATION_FIELDS_FILE_NAME'];
        const validationFileBuffer = await downloadFileFromGcs(bucketName, validationFileName);
        const validationString = validationFileBuffer.toString('utf8');
        const validationJson = JSON.parse(validationString);
        const { formData } = req.body;
        const invalidFields = validateFields(validationJson, formData);
        if (invalidFields){
            return res.status(400).json({
                error: 'Invalid values found',
                invalidFields
            });
        }
        next(); // Proceed if all validations pass
    }
}

// Helper function to download PDF from Google Cloud Storage
async function downloadFileFromGcs(bucketName, fileName) {
    const bucket = storage.bucket(bucketName);
    const file = bucket.file(fileName);

    const fileStream = new stream.PassThrough();
    await file.createReadStream().pipe(fileStream);

    return new Promise((resolve, reject) => {
        const chunks = [];
        fileStream.on('data', (chunk) => chunks.push(chunk));
        fileStream.on('end', () => resolve(Buffer.concat(chunks)));
        fileStream.on('error', (err) => reject(err));
    });
}

app.post('/fill_pdf', get_and_validate(), async (req, res) => {
    const { formData, flattenFields } = req.body; // Separate formData and flattenFields

    // Download the PDF template and validation fields from GCS
    let inputPdfBuffer;
    try {
        const templatePdfName = envVars['TEMPLATE_PDF_FILE_NAME'];
        inputPdfBuffer = await downloadFileFromGcs(bucketName, templatePdfName);
    } catch (error) {
        return res.status(500).send('Error while downloading pdf template');
    }

    // Fill PDF form
    try {
        const filledPdfBuffer = await fillPdfForm(inputPdfBuffer, formData, flattenFields);
        res.setHeader('Content-Type', 'application/pdf');
        res.end(filledPdfBuffer ,'binary');
    } catch (error) {
        console.error(error);
        res.status(500).send('Error while filling pdf');
    }
});

async function fillPdfForm(templateBuffer, fieldValues, flatten) {
    const pdfDoc = await PDFDocument.load(templateBuffer);
    const form = pdfDoc.getForm();

    // Iterate over field values
    const keys = Object.keys(fieldValues);
    for (var i = 0; i < keys.length; i++) {
        const key = keys[i];
        const value = fieldValues[key];
        if (value === "" || value === null){
            continue;
        }

        try {
            const isRadioButton = (field) => {return form.getField(field).constructor.name === 'PDFRadioGroup';};

            if (isRadioButton(key)) {
                form.getRadioGroup(key).select(value);
            } else {
                form.getTextField(key).setText(value);
            }
        } catch (error) {
            console.error(`Could not find field "${key}": ${error.message}`);
        }
    }
    //flatten the form so it's no longer editable
    if(flatten){
        form.getFields().forEach(field => field.enableReadOnly());
    }
    return await pdfDoc.save();
}

async function printFormFieldNames() {
    const templatePdfName = envVars['TEMPLATE_PDF_FILE_NAME'];
    const inputPdfBuffer = await downloadFileFromGcs(bucketName, templatePdfName);
    const pdfDoc = await PDFDocument.load(inputPdfBuffer);
    const form = pdfDoc.getForm();
    const fieldNames = form.getFields().map(field => field.getName());
    console.log("Available fields in PDF:", JSON.stringify(fieldNames, null, 2));
}


const PORT = envVars.HOSTPORT || 8080;
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});

// const fields = JSON.parse(fs.readFileSync('sample_fields.json', 'utf8'));
// const templatePath = "./CMS1500_radios.pdf";
// import fs from 'fs';
// const templatePdfBuffer = fs.readFileSync(templatePath);
// const result = await fillPdfForm(templatePdfBuffer, fields);
// fs.writeFileSync('./example2.pdf', result);

// printFormFieldNames()
