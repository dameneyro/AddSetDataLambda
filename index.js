const { Client } = require('pg');
const AWS = require('aws-sdk');
const ssm = new AWS.SSM();

exports.handler = async (event) => {
    console.log("IN THE LAMBDA WITH EVENT: ", JSON.stringify(event, null, 2));

    let client;

    const exerciseId = event.pathParameters["exercise-id"];
    const workoutId = event.pathParameters["workout-id"];
    let sets;

    try {
        const params = { Name: '/Life/LocalDatabase', WithDecryption: true };
        const data = await ssm.getParameter(params).promise();
        const dbConfig = JSON.parse(data.Parameter.Value);

        client = new Client({
            host: dbConfig.DB_HOST,
            database: dbConfig.DB_NAME,
            user: dbConfig.DB_USER,
            password: dbConfig.DB_PASSWORD,
            port: dbConfig.DB_PORT
        });

        await client.connect();

        if (event.httpMethod === 'GET') {
            // Fetch existing sets
            console.log("Fetching sets for exerciseId: ", exerciseId);
            const setsRes = await client.query(
                'SELECT * FROM fitness.completed_sets WHERE completed_exercise_id = $1',
                [exerciseId]
            );
            sets = setsRes.rows;

            return {
                statusCode: 200,
                headers: {
                    'Access-Control-Allow-Origin': '*',
                    'Access-Control-Allow-Credentials': true,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ status: 'success', sets }),
            };
        } else if (event.httpMethod === 'POST') {
            // Save or update sets
            const requestBody = event.body ? JSON.parse(event.body) : {};
            sets = requestBody.sets || [];

            console.log("Sets: ", sets);

            if (!exerciseId) {
                throw new Error("exerciseId is required");
            }

            let savedSets = [];

            for (const set of sets) {
                const { completed_set_id, reps, weight, rest_time, set_type_id, rir, rpe } = set;

                let queryResult;

                if (!completed_set_id) {
                    // Create new set
                    console.log("CREATING NEW SET");
                    queryResult = await client.query(
                        'INSERT INTO fitness.completed_sets (completed_exercise_id, reps, weight, rest_time, set_type_id, rir, rpe) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING completed_set_id, completed_exercise_id, reps, weight, rest_time, set_type_id, rir, rpe',
                        [exerciseId, reps, weight, rest_time, set_type_id, rir, rpe]
                    );
                } else {
                    // Update existing set
                    console.log("UPDATING EXISTING SET");
                    queryResult = await client.query(
                        'UPDATE fitness.completed_sets SET reps = $1, weight = $2, rest_time = $3, rir = $4, rpe = $5 WHERE completed_set_id = $6 RETURNING completed_set_id, completed_exercise_id, reps, weight, rest_time, set_type_id, rir, rpe',
                        [reps, weight, rest_time, rir, rpe, completed_set_id]
                    );
                }

                savedSets.push(queryResult.rows[0]);
            }

            console.log("SETS FROM LAMBDA: ", savedSets);

            return {
                statusCode: 200,
                headers: {
                    'Access-Control-Allow-Origin': '*',
                    'Access-Control-Allow-Credentials': true,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ status: 'success', sets: savedSets }),
            };
        }
    } catch (err) {
        console.error(err);
        return {
            statusCode: 500,
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Credentials': true,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ error: 'Internal Server Error', message: err.message }),
        };
    } finally {
        if (client) {
            await client.end();
        }
    }
};
